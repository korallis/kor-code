import { createHash } from 'node:crypto';
import type { AcceptanceFinding, Execution } from '@kor-code/core';
import { stableId, type Completion, type TrackerClient, type TrackerIssue, type TrackerWrite, type WorkflowMapping } from './contract.js';
import { TrackerStore, sessionRecord, type ExecutionClaim } from './store.js';

export class SnapshotReader {
  constructor(private readonly client: TrackerClient) {}
  async read(issueId: string): Promise<{ snapshotId: string; observedAt: string; issue: TrackerIssue }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const issue = await this.client.getIssue(issueId);
      const snapshotId = this.digest(issue);
      if (snapshotId === this.digest(await this.client.getIssue(issueId))) return { snapshotId, observedAt: new Date().toISOString(), issue };
    }
    throw new Error('Tracker snapshot changed during discovery; retry reconciliation');
  }
  private digest(issue: TrackerIssue): string { return createHash('sha256').update(JSON.stringify(issue)).digest('hex'); }
}

export class DurableQueue {
  constructor(readonly store: TrackerStore) {}
  enqueue(issueId: string) { return this.store.enqueue(issueId); }
}
export class ExecutionLease {
  constructor(private readonly store: TrackerStore) {}
  claim(owner: string, ttlMs?: number, issueId?: string) { return this.store.claim(owner, ttlMs, issueId); }
  renew(claim: ExecutionClaim, ttlMs?: number): void { this.store.renew(claim, ttlMs); }
  release(claim: ExecutionClaim, delayMs?: number): void { this.store.release(claim, delayMs); }
  reclaimExpired(issueId: string): boolean { return this.store.reclaimExpired(issueId); }
}

// No policy decisions or execution launcher here: Phase 2 supplies the manifest
// and Phase 3 authorizes dispatch. This boundary records only explicit changes.
export class AgentSessionWriter {
  constructor(private readonly store: TrackerStore, private readonly client: TrackerClient, private readonly states: WorkflowMapping) {}

  start(claim: ExecutionClaim, manifest: Execution): void {
    const assignment = claim.assignment;
    if (manifest.id !== assignment.executionId || manifest.issueId !== assignment.issueId || manifest.status !== 'running') throw new Error('Manifest does not match the claimed execution');
    this.store.transition(claim, 'running', startWrites(assignment, this.states, this.client), manifest);
  }

  complete(claim: ExecutionClaim, completion: Completion): void {
    if (!completion.summary.trim() || completion.evidence.length === 0 || completion.evidence.some(evidence => evidence.status !== 'pass')) throw new Error('Completion requires passing evidence and a summary');
    const assignment = claim.assignment;
    const body = [completion.summary, ...completion.evidence.map(evidence => `${evidence.kind}: ${evidence.summary}${evidence.source ? ` (${evidence.source})` : ''}`), completion.pullRequestUrl ?? ''].filter(Boolean).join('\n');
    const writes: TrackerWrite[] = [
      { kind: 'comment', id: stableId('kor-progress', `${assignment.executionId}:complete`), issueId: assignment.issueId, body },
      { kind: 'state', issueId: assignment.issueId, stateId: completion.pullRequestUrl && this.states.review ? this.states.review.id : this.states.complete.id },
    ];
    if (completion.pullRequestUrl) writes.push({ kind: 'attachment', issueId: assignment.issueId, url: completion.pullRequestUrl, title: 'GitHub pull request' });
    if (this.client.supportsAgentSessions?.(assignment.issueId) ?? this.client.capabilities?.agentSessions) {
      writes.unshift(
        { kind: 'summary', sessionId: assignment.sessionId, summary: body },
        { kind: 'activity', id: stableId('kor-activity', `${assignment.executionId}:complete`), sessionId: assignment.sessionId, activity: 'response', body },
      );
    }
    this.store.transition(claim, 'complete', writes);
  }

  cancel(claim: ExecutionClaim, reason = 'Execution canceled by operator'): void {
    const state = this.states.queued;
    this.store.record(claim, [
      { kind: 'comment', id: stableId('kor-progress', `${claim.assignment.executionId}:cancel`), issueId: claim.assignment.issueId, body: `Kor canceled execution ${claim.assignment.executionId}: ${reason}` },
      { kind: 'state', issueId: claim.assignment.issueId, stateId: state.id },
    ]);
    this.store.release(claim);
  }

  recordVerificationBlock(claim: ExecutionClaim, execution: Execution, findings: readonly AcceptanceFinding[], blockers: readonly string[] = []): void {
    const body = [`Execution ${execution.id} blocked: acceptance evidence is incomplete`, ...(blockers.length > 0 ? ['Blockers:', ...blockers.map(blocker => `- ${blocker}`)] : []), ...findings.map(finding => `${finding.conditionId}: ${finding.status}${finding.evidenceIds.length > 0 ? ` (${finding.evidenceIds.join(', ')})` : ''}${finding.note ? ` — ${finding.note}` : ''}`)].join('\n');
    const writes: TrackerWrite[] = [{ kind: 'comment', id: stableId('kor-progress', `${claim.assignment.executionId}:blocked:${body}`), issueId: claim.assignment.issueId, body }];
    if (this.client.supportsAgentSessions?.(claim.assignment.issueId) ?? this.client.capabilities?.agentSessions) writes.unshift(
      { kind: 'summary', sessionId: claim.assignment.sessionId, summary: body },
      { kind: 'activity', id: stableId('kor-activity', `${claim.assignment.executionId}:blocked:${body}`), sessionId: claim.assignment.sessionId, activity: 'error', body },
    );
    this.store.record(claim, writes, execution);
  }

  async flush(maximum = 100): Promise<number> {
    return flushTrackerWrites(this.store, this.client, maximum);
  }
}

/** Flush already-authorized outbox writes even when no execution is running. */
export async function flushTrackerWrites(store: TrackerStore, client: TrackerClient, maximum = 100): Promise<number> {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Write batch limit must be positive');
    const token = store.claimWriter();
    if (!token) return 0;
    let count = 0;
    let sequence = 0;
    let failure: unknown;
    const blocked = new Set<string>();
    const issues = new Map(store.listAssignments().map(assignment => [assignment.sessionId, assignment.issueId]));
    try {
      const lastSequence = store.lastWriteSequence(token);
      while (count < maximum) {
        const pending = store.nextWrite(token, sequence);
        if (!pending || pending.sequence > lastSequence) break;
        sequence = pending.sequence;
        const write = pending.write;
        const issue = write.kind === 'session' ? write.session.issueId : 'issueId' in write ? write.issueId : issues.get(write.sessionId) ?? write.sessionId;
        if (blocked.has(issue)) continue;
        try {
          await client.apply(write);
          store.acknowledgeWrite(token, pending.sequence);
          count++;
        } catch (error) { blocked.add(issue); failure ??= error; }
      }
      if (blocked.size) throw failure;
      return count;
    } finally { store.releaseWriter(token); }
}

export function startWrites(assignment: ExecutionClaim['assignment'], states: WorkflowMapping, client?: TrackerClient): TrackerWrite[] {
  const writes: TrackerWrite[] = [
    { kind: 'state', issueId: assignment.issueId, stateId: states.running.id },
    { kind: 'comment', id: stableId('kor-progress', `${assignment.executionId}:start`), issueId: assignment.issueId, body: `Kor started execution ${assignment.executionId}; state → ${states.running.name ?? 'In Progress'}` },
  ];
  if (client?.supportsAgentSessions?.(assignment.issueId) ?? client?.capabilities?.agentSessions) writes.push(
    { kind: 'session', session: sessionRecord(assignment) },
    { kind: 'summary', sessionId: assignment.sessionId, summary: `Execution ${assignment.executionId} running` },
    { kind: 'activity', id: stableId('kor-activity', `${assignment.executionId}:start`), sessionId: assignment.sessionId, activity: 'thought', body: `Execution ${assignment.executionId} started` },
  );
  return writes;
}
