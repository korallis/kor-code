// The activity feed: what changed, newest first, built only from runs,
// decisions and the override audit the daemon reports.
import type { LucideIcon } from 'lucide-react';
import { CircleCheck, CircleX, GitPullRequest, Route, TriangleAlert, WandSparkles, Play, GitMerge } from 'lucide-react';
import type { MissionRun } from '@kor-code/mission-control';
import type { DecisionRecord, OverrideRecord } from '@kor-code/core';
import type { Tone } from '../ui/text';
import { acceptanceSummary, checksSummary, keyOf, prNumber } from './runs';

export interface Activity { id: string; at: string; tone: Tone; icon: LucideIcon; key: string; executionId: string; text: string }

export function buildActivity(runs: readonly MissionRun[], overrides: readonly OverrideRecord[], decisions: readonly DecisionRecord[] = []): Activity[] {
  const out: Activity[] = [];
  for (const run of runs) {
    const key = keyOf(run);
    const base = { at: run.observedAt, key, executionId: run.executionId };
    const checks = checksSummary(run), acceptance = acceptanceSummary(run);
    const detail = [checks && `${checks.passed}/${checks.total} checks`, acceptance && `${acceptance.passed}/${acceptance.total} acceptance conditions`].filter(Boolean).join(', ');
    switch (run.status) {
      case 'complete': out.push({ ...base, id: `${run.executionId}:c`, tone: 'green', icon: run.pullRequestUrl ? GitMerge : CircleCheck, text: run.pullRequestUrl ? `merged ${prNumber(run.pullRequestUrl) ?? ''}` : 'complete' }); break;
      case 'review': out.push({ ...base, id: `${run.executionId}:r`, tone: 'violet', icon: GitPullRequest, text: `PR ${prNumber(run.pullRequestUrl) ?? ''} opened · Linear moved to ${run.issueState ?? 'In Review'}` }); break;
      case 'waiting': out.push({ ...base, id: `${run.executionId}:w`, tone: 'green', icon: CircleCheck, text: `verified${detail ? `: ${detail}` : ''} · waiting for you` }); break;
      case 'failed': out.push({ ...base, id: `${run.executionId}:f`, tone: 'rose', icon: CircleX, text: `failed${run.error ? `: ${run.error}` : ''}` }); break;
      case 'blocked': case 'escalated': out.push({ ...base, id: `${run.executionId}:b`, tone: 'amber', icon: TriangleAlert, text: `${run.status}${run.needsInput?.reason ? `: ${run.needsInput.reason}` : run.error ? `: ${run.error}` : ''}` }); break;
      case 'running': case 'evaluating': case 'verifying': case 'repairing': case 'shipping': out.push({ ...base, id: `${run.executionId}:a`, tone: 'cyan', icon: Play, text: `${run.status} · ${run.stage}` }); break;
      default: break;
    }
  }
  for (const record of overrides) {
    const run = runs.find(one => one.executionId === record.executionId);
    out.push({ id: `o:${record.id}`, at: record.recordedAt, tone: record.status === 'rejected' ? 'rose' : 'cyan', icon: WandSparkles, key: run ? keyOf(run) : record.issueId.slice(0, 8), executionId: record.executionId,
      text: record.status === 'rejected' ? `override refused: ${record.target} → ${record.choice} (${record.reason})` : record.status === 'reverted' ? `override reverted: ${record.target}` : `${record.target} overridden: ${record.previous ?? '—'} → ${record.choice}` });
  }
  for (const decision of decisions.filter(one => one.escalated)) {
    const run = runs.find(one => one.executionId === decision.executionId);
    out.push({ id: `d:${decision.decisionId}`, at: decision.recordedAt, tone: 'amber', icon: Route, key: run ? keyOf(run) : decision.executionId.slice(0, 8), executionId: decision.executionId, text: `Jev escalated ${decision.kind}: ${decision.choice}` });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
