// The live store: one server-sent-event stream from the daemon, held outside
// React and read with useSyncExternalStore. It opens on the first subscriber,
// closes on the last, and reconnects with Last-Event-ID.
import { useSyncExternalStore } from 'react';
import { API_PREFIX, type MissionEvent, type MissionRun, type PoolResponse, type Stage } from '@kor-code/mission-control';
import type { DecisionRecord, KorStatusResponse, OverrideRecord } from '@kor-code/core';
import { authHeaders } from './client';
import { queryClient } from './query';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'unauthorized' | 'offline';
export interface TerminalChunk { offset: number; channel: 'stdout' | 'stderr' | 'daemon'; text: string; at: number }
export interface LiveState {
  connection: Connection;
  status: KorStatusResponse | null;
  runs: MissionRun[];
  decisions: DecisionRecord[];
  /** The override audit, newest first: seeded by snapshots, updated by every apply or revert. */
  overrides: OverrideRecord[];
  accounts: PoolResponse['accounts'] | null;
  quota: PoolResponse['quota'] | null;
  terminals: Readonly<Record<string, readonly TerminalChunk[]>>;
  /** Run IDs whose `deciding` moment (a new decision) should play once. */
  decidedAt: Readonly<Record<string, number>>;
  /** Run IDs that just reached review or complete, for the shipped moment. */
  shippedAt: Readonly<Record<string, number>>;
  /** Active-run counts sampled from events since this page opened. */
  activity: readonly { at: number; active: number }[];
  lastEventAt: number | null;
  restartRequired: boolean;
  reason: string | null;
}

const ACTIVE = new Set(['evaluating', 'running', 'verifying', 'repairing', 'shipping']);
const TERMINAL_LIMIT = 4_000;

let state: LiveState = {
  connection: 'connecting', status: null, runs: [], decisions: [], overrides: [], accounts: null, quota: null,
  terminals: {}, decidedAt: {}, shippedAt: {}, activity: [], lastEventAt: null, restartRequired: false, reason: null,
};
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let lastEventId: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;

function set(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function sample(runs: MissionRun[]): LiveState['activity'] {
  const active = runs.filter(run => ACTIVE.has(run.status)).length;
  const last = state.activity.at(-1);
  if (last && last.active === active && Date.now() - last.at < 60_000) return state.activity;
  return [...state.activity, { at: Date.now(), active }].slice(-60);
}

function upsert(run: MissionRun): MissionRun[] {
  const index = state.runs.findIndex(existing => existing.executionId === run.executionId);
  if (index === -1) return [run, ...state.runs];
  const next = state.runs.slice();
  next[index] = run;
  return next;
}

function shipped(previous: MissionRun | undefined, run: MissionRun): LiveState['shippedAt'] {
  const reached = (run.status === 'review' || run.status === 'complete') && previous !== undefined && previous.status !== run.status && previous.status !== 'review';
  return reached ? { ...state.shippedAt, [run.executionId]: Date.now() } : state.shippedAt;
}

function apply(event: MissionEvent): void {
  const at = Date.now();
  switch (event.kind) {
    case 'snapshot': {
      const decisions = event.status.snapshot?.decisions?.value ?? state.decisions;
      set({ status: event.status, runs: event.runs, decisions, overrides: event.status.snapshot?.overrides ?? state.overrides, activity: sample(event.runs), lastEventAt: at, reason: event.status.provenance === 'live' ? null : event.status.reason ?? null });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      return;
    }
    case 'run': {
      const previous = state.runs.find(run => run.executionId === event.run.executionId);
      const runs = upsert(event.run);
      set({ runs, shippedAt: shipped(previous, event.run), activity: sample(runs), lastEventAt: at });
      void queryClient.invalidateQueries({ queryKey: ['run', event.run.executionId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      return;
    }
    case 'stage': {
      const runs = state.runs.map(run => run.executionId === event.executionId ? { ...run, stage: event.stage as Stage } : run);
      set({ runs, lastEventAt: at });
      return;
    }
    case 'terminal': {
      const existing = state.terminals[event.executionId] ?? [];
      // Session output is keyed by its end offset; daemon log lines all carry offset 0, so they dedupe by text.
      if (existing.some(chunk => event.channel === 'daemon' ? chunk.channel === 'daemon' && chunk.text === event.text : chunk.channel !== 'daemon' && chunk.offset === event.offset)) return;
      const next = [...existing, { offset: event.offset, channel: event.channel, text: event.text, at }].slice(-TERMINAL_LIMIT);
      set({ terminals: { ...state.terminals, [event.executionId]: next }, lastEventAt: at });
      return;
    }
    case 'decision': {
      const decisions = [event.decision, ...state.decisions.filter(decision => decision.decisionId !== event.decision.decisionId)];
      set({ decisions, decidedAt: { ...state.decidedAt, [event.decision.executionId]: at }, lastEventAt: at });
      void queryClient.invalidateQueries({ queryKey: ['brain'] });
      return;
    }
    case 'needs-input': {
      const runs = state.runs.map(run => run.executionId === event.executionId ? { ...run, needsInput: event.reason === null ? null : { reason: event.reason } } : run);
      set({ runs, lastEventAt: at });
      return;
    }
    case 'pool': set({ accounts: event.accounts, lastEventAt: at }); void queryClient.invalidateQueries({ queryKey: ['pool'] }); return;
    case 'usage': set({ quota: event.quota, lastEventAt: at }); return;
    case 'ask': queryClient.setQueryData(['ask', event.response.id], event.response); set({ lastEventAt: at }); return;
    case 'config': set({ restartRequired: event.restartRequired, lastEventAt: at }); void queryClient.invalidateQueries({ queryKey: ['config'] }); void queryClient.invalidateQueries({ queryKey: ['projects'] }); return;
    case 'reset': set({ reason: event.reason, lastEventAt: at }); return;
  }
}

function parseBlock(block: string): void {
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line === '') continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (id !== null) lastEventId = id;
  if (data.length === 0) return;
  try { apply(JSON.parse(data.join('\n')) as MissionEvent); } catch { /* a malformed frame is skipped; the next snapshot repairs state */ }
}

async function connect(): Promise<void> {
  const abort = new AbortController();
  controller = abort;
  set({ connection: retries === 0 ? 'connecting' : 'reconnecting' });
  // A pending handshake can outlive a healthy REST connection. Bound only the
  // wait for headers; a connected event stream must remain open indefinitely.
  let handshakeTimedOut = false;
  const handshakeTimer = setTimeout(() => { handshakeTimedOut = true; abort.abort(); }, 5_000);
  try {
    const response = await fetch(`${API_PREFIX}/events`, {
      headers: { ...authHeaders(), accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
      signal: abort.signal, cache: 'no-store', credentials: 'omit',
    });
    clearTimeout(handshakeTimer);
    if (controller !== abort || abort.signal.aborted) return;
    if (response.status === 401 || response.status === 403) { set({ connection: 'unauthorized', reason: 'This browser session is not authorised. Open Mission Control with `kor ui`.' }); controller = null; return; }
    if (!response.ok || !response.body) throw new Error(`events answered ${response.status}`);
    retries = 0;
    set({ connection: 'live', reason: null });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n?/g, '\n');
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        parseBlock(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
    throw new Error('event stream ended');
  } catch {
    if (controller !== abort || abort.signal.aborted && !handshakeTimedOut) return;
    controller = null;
    retries += 1;
    set({ connection: retries > 2 ? 'offline' : 'reconnecting', reason: 'Lost the daemon event stream; reconnecting.' });
    retryTimer = setTimeout(() => { retryTimer = null; if (listeners.size > 0) void connect(); }, Math.min(15_000, 1_000 * 2 ** Math.min(retries, 4)));
  } finally {
    clearTimeout(handshakeTimer);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && controller === null && retryTimer === null && document.visibilityState !== 'hidden') void connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      controller?.abort();
      controller = null;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    }
  };
}

// A hidden tab releases its stream (browsers allow six connections per host,
// and every open tab would otherwise hold one) and resumes from its last event.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      controller?.abort();
      controller = null;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    } else if (listeners.size > 0 && controller === null && retryTimer === null) {
      retries = 0;
      void connect();
    }
  });
}

/** The daemon's full override audit, from a REST status read. */
export function replaceOverrides(records: OverrideRecord[]): void {
  set({ overrides: records });
}

/** Record an override the daemon just applied, refused or reverted, so every view shows it at once. */
export function upsertOverride(record: OverrideRecord): void {
  set({ overrides: [record, ...state.overrides.filter(existing => existing.id !== record.id)] });
}

/** Reconnect now (the offline banner's button). */
export function reconnect(): void {
  controller?.abort();
  controller = null;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  retries = 0;
  void connect();
}

/** Read one slice of the live store. The selector must return a stable value (a slice of state or a primitive). */
export function useLive<T>(select: (live: LiveState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}
