import type { Execution } from '@kor-code/core';
import { type LinearClient, type LinearIssue, type LinearWrite } from './contract.js';
export class FakeLinearClient implements LinearClient {
  readonly writes: LinearWrite[] = []; private readonly issues = new Map<string, LinearIssue>();
  constructor(issues: LinearIssue[] = []) { for (const issue of issues) this.issues.set(issue.id, structuredClone(issue)); }
  async getIssue(id: string): Promise<LinearIssue> { const issue = this.issues.get(id); if (!issue) throw new Error(`fake issue missing: ${id}`); return structuredClone(issue); }
  async listIssues(teamKey: string): Promise<LinearIssue[]> { return [...this.issues.values()].filter(issue => issue.teamId === teamKey).map(issue => structuredClone(issue)); }
  async apply(write: LinearWrite): Promise<void> { this.writes.push(structuredClone(write)); if (write.kind === 'state') { const issue = this.issues.get(write.issueId); if (!issue) throw new Error('fake issue missing'); issue.stateId = write.stateId; issue.stateType = write.stateId; } if (write.kind === 'session') { const issue = this.issues.get(write.session.issueId); if (!issue) throw new Error('fake issue missing'); issue.sessions.push({ id: write.session.id, status: 'created' }); } }
  async recordExecution(execution: Execution): Promise<void> { await this.apply({ kind: 'session', session: { id: execution.id, executionId: execution.id, issueId: execution.issueId } }); }
  setIssueState(issueId: string, state: string): void { const issue = this.issues.get(issueId); if (!issue) throw new Error('fake issue missing'); issue.stateId = state; issue.stateType = state; }
}
export function fakeIssue(id = 'issue-1'): LinearIssue { return { id, title: 'Fixture issue', description: '# Acceptance\n- reaches complete', acceptanceCriteria: ['reaches complete'], teamId: 'LEE', stateId: 'queued', stateType: 'queued', updatedAt: new Date(0).toISOString(), priority: 2, documents: [], dependencies: [], subIssueIds: [], comments: [], sessions: [], resources: [] }; }
