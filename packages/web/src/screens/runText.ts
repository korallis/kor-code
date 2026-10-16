// Plain descriptions of where a run is and what happens next, from its status,
// stage and the daemon's own reasons. Nothing here is estimated.
import type { MissionRun } from '@kor-code/mission-control';

export function nextStep(run: MissionRun): { label: string; text: string } {
  switch (run.status) {
    case 'queued': return { label: 'WAITS', text: 'For a free slot under the total and per-repository limits.' };
    case 'ready': return { label: 'NEXT', text: 'Jev judges readiness, complexity and risk, then picks the route.' };
    case 'evaluating': return { label: 'NEXT', text: 'Jev is deciding readiness, route, context, skill and agent.' };
    case 'running': return { label: 'NEXT', text: `The session works in ${run.branch ?? 'its worktree'}; Kor verifies when it ends.` };
    case 'verifying': return { label: 'NEXT', text: 'Repository checks run, then Jev judges each acceptance condition.' };
    case 'repairing': return { label: 'NEXT', text: 'The session repairs what verification found, then Kor verifies again.' };
    case 'waiting': return { label: 'NEXT', text: 'Your go-ahead to ship: approve, or request changes.' };
    case 'shipping': return { label: 'NEXT', text: 'Commit, delivery gate, then the pull request and tracker update.' };
    case 'review': return { label: 'NEXT', text: run.shipping?.mergeEnabled ? run.shipping.error ?? 'Kor checks the independent review, GitHub checks and Jev’s merge decision before merging.' : 'Review and merge the pull request on GitHub; Kor marks the issue Done after.' };
    case 'blocked': case 'escalated': return { label: 'NEEDS YOU', text: run.needsInput?.reason ?? run.error ?? 'The run stopped and needs your direction.' };
    case 'failed': return { label: 'FAILED', text: run.error ?? 'The run failed; retry it or read the log.' };
    case 'complete': return { label: 'DONE', text: run.pullRequestUrl ? 'Merged.' : 'Complete.' };
    case 'canceled': return { label: 'CANCELED', text: 'Canceled. Retry to start it again.' };
  }
}
