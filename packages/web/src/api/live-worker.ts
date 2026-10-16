import { API_PREFIX, type MissionEvent } from '@kor-code/mission-control';
import type { Connection, StreamCommand, StreamMessage } from './stream-types';

const STREAM_TIMEOUT = 35_000;
const BOOTSTRAP_BYTES = 2_000_000;
const ports = new Set<MessagePort>();
let headers: Record<string, string> = {};
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let lastEventId: string | null = null;
let connection: Connection = 'connecting';
let reason: string | null = null;
let snapshot: MissionEvent | null = null;
let quota: MissionEvent | null = null;
let tail: MissionEvent[] = [];
let tailBytes = 0;

function broadcast(message: StreamMessage): void {
  for (const port of ports) port.postMessage(message);
}

function status(value: Connection, why: string | null = null): void {
  connection = value;
  reason = why;
  broadcast({ kind: 'connection', connection, reason });
}

function parseBlock(block: string): boolean {
  const data: string[] = [];
  for (const line of block.split('\n')) if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  if (!data.length) return false;
  const event = JSON.parse(data.join('\n')) as MissionEvent;
  lastEventId = event.id;
  if (event.kind === 'reset') { snapshot = null; quota = null; tail = []; tailBytes = 0; }
  else if (event.kind === 'snapshot') { snapshot = event; tail = []; tailBytes = 0; }
  else {
    if (event.kind === 'usage') quota = event;
    tail.push(event);
    tailBytes += JSON.stringify(event).length;
    // New tabs also fetch complete transcripts, so bounded bootstrap history is sufficient.
    while (tail.length > 512 || tailBytes > BOOTSTRAP_BYTES) {
      const removed = tail.shift();
      if (removed) tailBytes -= JSON.stringify(removed).length;
    }
  }
  broadcast({ kind: 'event', event });
  return event.kind === 'snapshot';
}

async function connect(): Promise<void> {
  const abort = new AbortController();
  controller = abort;
  status(retries === 0 ? 'connecting' : 'reconnecting');
  let timedOut = false;
  let timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 5_000);
  try {
    const response = await fetch(`${API_PREFIX}/events`, {
      headers: { ...headers, accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
      signal: abort.signal, cache: 'no-store', credentials: 'omit',
    });
    clearTimeout(timeout);
    if (controller !== abort || abort.signal.aborted) return;
    if (response.status === 401 || response.status === 403) { controller = null; status('unauthorized', 'This browser session is not authorised. Open Mission Control with `kor ui`.'); return; }
    if (!response.ok || !response.body) throw new Error(`events answered ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let synchronized = false;
    for (;;) {
      timeout = setTimeout(() => { timedOut = true; abort.abort(); }, STREAM_TIMEOUT);
      const { value, done } = await reader.read();
      clearTimeout(timeout);
      if (controller !== abort) return;
      if (timedOut) throw new Error('event stream timed out');
      if (abort.signal.aborted) return;
      if (done) break;
      buffer += value.replace(/\r\n?/g, '\n');
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const current = parseBlock(buffer.slice(0, split));
        if (!synchronized && current) { synchronized = true; retries = 0; status('live'); }
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
    throw new Error('event stream ended');
  } catch {
    if (controller !== abort || abort.signal.aborted && !timedOut) return;
    abort.abort();
    controller = null;
    retries += 1;
    status(retries > 2 ? 'offline' : 'reconnecting', 'Lost the daemon event stream; reconnecting.');
    retryTimer = setTimeout(() => { retryTimer = null; if (ports.size) void connect(); }, Math.min(15_000, 1_000 * 2 ** Math.min(retries, 4)));
  } finally { clearTimeout(timeout); }
}

function disconnect(): void {
  controller?.abort();
  controller = null;
  connection = 'connecting';
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

addEventListener('connect', event => {
  if (!(event instanceof MessageEvent)) return;
  const port = event.ports[0];
  if (!port) return;
  port.onmessage = ({ data }: MessageEvent<StreamCommand>) => {
    if (data.kind === 'subscribe') {
      headers = data.headers;
      ports.add(port);
      if (snapshot) {
        port.postMessage({ kind: 'event', event: snapshot } satisfies StreamMessage);
        if (quota) port.postMessage({ kind: 'event', event: quota } satisfies StreamMessage);
        for (const event of tail) port.postMessage({ kind: 'event', event } satisfies StreamMessage);
      }
      port.postMessage({ kind: 'connection', connection, reason } satisfies StreamMessage);
      if (!controller && !retryTimer) void connect();
    } else if (data.kind === 'unsubscribe') {
      ports.delete(port);
      port.close();
      if (!ports.size) disconnect();
    } else if (ports.has(port)) {
      disconnect();
      retries = 0;
      void connect();
    }
  };
  port.start();
});
