// The live store: one server-sent-event stream from the daemon, held outside
// React and read with useSyncExternalStore. It opens on the first subscriber,
// closes on the last, and reconnects with Last-Event-ID.
import { useSyncExternalStore } from 'react';
import { API_PREFIX, type LiveResource, type MissionEvent, type MissionRun, type PoolResponse } from '@kor-code/mission-control';
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
const STREAM_TIMEOUT = 35_000;

let state: LiveState = {
  connection: 'connecting', status: null, runs: [], decisions: [], overrides: [], accounts: null, quota: null,
  terminals: {}, decidedAt: {}, shippedAt: {}, activity: [], lastEventAt: null, restartRequired: false, reason: null,
};
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let lastEventId: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;

function invalidate(resources: readonly LiveResource[]): void {
  for (const resource of resources) void queryClient.invalidateQueries({ queryKey: [resource] });
}

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
      const decisions = event.status.snapshot?.decisions?.value ?? [];
      set({ status: event.status, runs: event.runs, decisions, overrides: event.status.snapshot?.overrides ?? [], accounts: event.status.snapshot?.accounts ?? null, activity: sample(event.runs), lastEventAt: at, reason: event.status.provenance === 'live' ? null : event.status.reason ?? null });
      queryClient.setQueryData(['status'], event.status);
      queryClient.setQueryData(['runs'], { schemaVersion: 1, runs: event.runs });
      invalidate(['projects', 'run', 'session', 'brain']);
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
      const runs = state.runs.map(run => run.executionId === event.executionId ? { ...run, stage: event.stage } : run);
      set({ runs, lastEventAt: at });
      invalidate(['run']);
      return;
    }
    case 'terminal': {
      const existing = state.terminals[event.executionId] ?? [];
      // Every chunk, session output or daemon log line, is keyed by its end offset in the run's transcript.
      if (existing.some(chunk => chunk.offset === event.offset)) return;
      const next = [...existing, { offset: event.offset, channel: event.channel, text: event.text, at }].slice(-TERMINAL_LIMIT);
      set({ terminals: { ...state.terminals, [event.executionId]: next }, lastEventAt: at });
      if (existing.length >= TERMINAL_LIMIT) void queryClient.invalidateQueries({ queryKey: ['terminal', event.executionId] });
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
    case 'config': set({ restartRequired: event.restartRequired, lastEventAt: at }); invalidate(['config', 'projects', 'session', 'issues', 'pulls']); return;
    case 'invalidate':
      if (event.resources.includes('pool')) set({ accounts: null, quota: null });
      invalidate(event.resources); set({ lastEventAt: at }); return;
    case 'reset': set({ terminals: {}, accounts: null, quota: null, reason: event.reason, lastEventAt: at }); return;
    default: { const exhaustive: never = event; throw new Error(String(exhaustive)); }
  }
}

function parseBlock(block: string): boolean {
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
  if (data.length === 0) return false;
  try {
    const event = JSON.parse(data.join('\n')) as MissionEvent;
    apply(event);
    if (id !== null) lastEventId = id;
    return event.kind === 'snapshot';
  } catch (error) {
    lastEventId = null;
    throw error;
  }
}

async function connect(): Promise<void> {
  const abort = new AbortController();
  controller = abort;
  set({ connection: retries === 0 ? 'connecting' : 'reconnecting' });
  // A pending handshake can outlive a healthy REST connection. Bound only the
  // wait for headers; a connected event stream must remain open indefinitely.
  let timedOut = false;
  let timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 5_000);
  try {
    const response = await fetch(`${API_PREFIX}/events`, {
      headers: { ...authHeaders(), accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
      signal: abort.signal, cache: 'no-store', credentials: 'omit',
    });
    clearTimeout(timeout);
    if (controller !== abort || abort.signal.aborted) return;
    if (response.status === 401 || response.status === 403) { set({ connection: 'unauthorized', reason: 'This browser session is not authorised. Open Mission Control with `kor ui`.' }); controller = null; return; }
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
        const snapshot = parseBlock(buffer.slice(0, split));
        if (!synchronized && snapshot) {
          synchronized = true;
          retries = 0;
          // Inactive queries must also be stale when their screen next opens.
          // Refetch transcripts even when replay history no longer covers a gap.
          set({ connection: 'live', reason: null });
          void queryClient.invalidateQueries();
        }
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
    set({ connection: retries > 2 ? 'offline' : 'reconnecting', reason: 'Lost the daemon event stream; reconnecting.' });
    retryTimer = setTimeout(() => { retryTimer = null; if (listeners.size > 0) void connect(); }, Math.min(15_000, 1_000 * 2 ** Math.min(retries, 4)));
  } finally {
    clearTimeout(timeout);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && controller === null && retryTimer === null) void connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      controller?.abort();
      controller = null;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    }
  };
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
