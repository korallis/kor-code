// Each tab reads this store with useSyncExternalStore. A SharedWorker holds
// one authenticated event stream for every tab, including background tabs.
import { useSyncExternalStore } from 'react';
import { type LiveResource, type MissionEvent, type MissionRun, type PoolResponse } from '@kor-code/mission-control';
import type { DecisionRecord, KorStatusResponse, OverrideRecord } from '@kor-code/core';
import { authHeaders } from './client';
import { queryClient } from './query';

import type { StreamMessage } from './stream-types';
export type { Connection } from './stream-types';
import type { Connection } from './stream-types';
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
let worker: SharedWorker | null = null;

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

function connect(): void {
  if (worker) return;
  set({ connection: 'connecting' });
  const headers = authHeaders();
  const shared = new SharedWorker(new URL('./live-worker.ts', import.meta.url), { type: 'module', name: JSON.stringify(headers) });
  worker = shared;
  shared.port.onmessage = ({ data }: MessageEvent<StreamMessage>) => {
    if (worker !== shared) return;
    if (data.kind === 'event') apply(data.event);
    else {
      set({ connection: data.connection, reason: data.reason });
      // Every new attachment and reconnect resyncs inactive screens and transcripts.
      if (data.connection === 'live') void queryClient.invalidateQueries();
    }
  };
  shared.onerror = () => { set({ connection: 'offline', reason: 'The shared live connection failed. Reconnect to retry.' }); };
  shared.port.postMessage({ kind: 'subscribe', headers });
}

function disconnect(): void {
  worker?.port.postMessage({ kind: 'unsubscribe' });
  worker?.port.close();
  worker = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    connect();
    window.addEventListener('pagehide', disconnect);
    window.addEventListener('pageshow', connect);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      disconnect();
      window.removeEventListener('pagehide', disconnect);
      window.removeEventListener('pageshow', connect);
    }
  };
}

/** Reconnect now (the offline banner's button). */
export function reconnect(): void {
  if (!worker) connect();
  worker?.port.postMessage({ kind: 'reconnect' });
}

/** Read one slice of the live store. The selector must return a stable value (a slice of state or a primitive). */
export function useLive<T>(select: (live: LiveState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}
