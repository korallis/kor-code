// Composite reads: the live stream when it has spoken, the REST snapshot until then.
import type { MissionRun } from '@kor-code/mission-control';
import type { DecisionRecord, KorStatusResponse, OverrideRecord } from '@kor-code/core';
import { useLive } from './live';
import { useBrain, usePool, useRuns, useStatus } from './queries';

const EMPTY_RUNS: MissionRun[] = [];
const EMPTY_DECISIONS: DecisionRecord[] = [];

export function useMissionRuns(): { runs: MissionRun[]; loading: boolean; error: Error | null } {
  const liveStatus = useLive(live => live.status);
  const liveRuns = useLive(live => live.runs);
  const query = useRuns();
  if (liveStatus !== null) return { runs: liveRuns, loading: false, error: null };
  return { runs: query.data?.runs ?? EMPTY_RUNS, loading: query.isPending, error: query.error };
}

/** The fresher of the stream's snapshot and the polled REST status. */
export function useStatusResponse(): KorStatusResponse | undefined {
  const live = useLive(state => state.status);
  const query = useStatus();
  if (!live) return query.data;
  if (!query.data) return live;
  return Date.parse(query.data.observedAt) > Date.parse(live.observedAt) ? query.data : live;
}

export function useDecisions(): DecisionRecord[] {
  const live = useLive(state => state.decisions);
  const status = useStatusResponse();
  const brain = useBrain();
  if (live.length > 0) return live;
  return status?.snapshot?.decisions?.value ?? brain.data?.decisions.value ?? EMPTY_DECISIONS;
}

export function useOverrides(): OverrideRecord[] {
  useStatus();
  return useLive(state => state.overrides);
}

export function usePoolLive() {
  const accounts = useLive(state => state.accounts);
  const quota = useLive(state => state.quota);
  const query = usePool();
  return { accounts: accounts ?? query.data?.accounts ?? null, quota: quota ?? query.data?.quota ?? null, loading: query.isPending, error: query.error };
}
