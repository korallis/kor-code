// Derived run facts every screen shares. All of it comes from MissionRun.
import type { MissionRun } from '@kor-code/mission-control';
import type { DecisionRecord, RunLifecycle } from '@kor-code/core';

export const ACTIVE: ReadonlySet<RunLifecycle> = new Set(['evaluating', 'running', 'verifying', 'repairing', 'shipping']);
export const FINISHED: ReadonlySet<RunLifecycle> = new Set(['review', 'complete', 'failed', 'canceled']);

export const isActive = (run: MissionRun) => ACTIVE.has(run.status);
export const needsYou = (run: MissionRun) => run.needsInput !== null || run.status === 'blocked';
export const readyToShip = (run: MissionRun) => run.status === 'waiting';
export const keyOf = (run: MissionRun) => run.issueKey ?? run.issueId.slice(0, 8);
export const modelOf = (run: MissionRun) => run.route?.model;
export const slotOf = (run: MissionRun) => run.accountSlot.value ?? undefined;

/** Order runs as the Agents list does: needs you, waiting, active, queued, then finished newest first. */
const RANK: Record<RunLifecycle, number> = { blocked: 0, escalated: 0, waiting: 1, repairing: 2, running: 2, verifying: 2, evaluating: 2, shipping: 2, ready: 3, queued: 4, review: 5, complete: 6, failed: 6, canceled: 7 };
export function byAttention(a: MissionRun, b: MissionRun): number {
  return RANK[a.status] - RANK[b.status] || Date.parse(b.observedAt) - Date.parse(a.observedAt);
}

export function latestVerification(run: MissionRun) {
  return run.verification?.attempts.at(-1);
}

export function checksSummary(run: MissionRun): { passed: number; total: number } | null {
  const attempt = latestVerification(run);
  if (!attempt) return null;
  return { passed: attempt.checks.filter(check => check.status === 'pass').length, total: attempt.checks.length };
}

export function acceptanceSummary(run: MissionRun): { passed: number; total: number } | null {
  const attempt = latestVerification(run);
  if (!attempt || attempt.findings.length === 0) return null;
  return { passed: attempt.findings.filter(finding => finding.status === 'pass').length, total: attempt.findings.length };
}

export function decisionsFor(decisions: readonly DecisionRecord[], executionId: string): DecisionRecord[] {
  return decisions.filter(decision => decision.executionId === executionId).sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}
export function latestDecision(decisions: readonly DecisionRecord[], executionId: string, kind: string): DecisionRecord | undefined {
  return decisionsFor(decisions, executionId).filter(decision => decision.kind === kind).at(-1);
}

/** The PR number from a GitHub pull-request URL. */
export function prNumber(url: string | undefined): string | null {
  const match = url ? /\/pull\/(\d+)/.exec(url) : null;
  return match ? `#${match[1]}` : null;
}

/** The repository key a run belongs to: its configured repository, if the daemon reported it. */
export const repoOf = (run: MissionRun) => run.repository;

/** When a run last moved, as the daemon recorded it; undefined means undated. */
export function runUpdatedAt(run: MissionRun): string | undefined {
  return run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt ?? undefined;
}

/** Start of the run's latest execution attempt, as the daemon recorded it. */
export function runStartedAt(run: MissionRun): string | undefined {
  return run.startedAt ?? undefined;
}

/** A run's persisted spend records (every attempt), when the daemon reports them. */
export function spendOf(run: MissionRun) {
  return run.spend?.value ?? [];
}

/** Spend recorded on the given day, from each record's own time, never a run's cumulative cost. */
export function spendOn(runs: readonly MissionRun[], isDay: (iso: string) => boolean) {
  return runs.flatMap(run => spendOf(run).filter(record => record.costUsd !== null && isDay(record.recordedAt)).map(record => ({ run, record, costUsd: record.costUsd ?? 0 })));
}

/** A candidate's probability, when the decision reports per-candidate probabilities. */
export function probabilityOf(decision: DecisionRecord, candidate: string): number | undefined {
  const probabilities = (decision as DecisionRecord & { probabilities?: Record<string, number> }).probabilities;
  return probabilities?.[candidate] ?? (candidate === decision.choice ? decision.confidence : undefined);
}
