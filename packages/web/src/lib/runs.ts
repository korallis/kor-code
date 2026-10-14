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
