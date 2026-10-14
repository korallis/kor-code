import type { Execution } from '@kor-code/core';
import { linearIssueFixture, workflowStatesFixture } from './fixture.js';
import type { AgentSessionRecord, LinearClient, LinearIssue, LinearWorkflowState, LinearWrite } from './contract.js';

export interface FakeLinearOptions {
  teams?: Record<string, string>;
  workflowStates?: readonly LinearWorkflowState[];
}

export class FakeLinearClient implements LinearClient {
  readonly capabilities = { agentSessions: true };
  readonly writes: LinearWrite[] = [];
  private readonly issues = new Map<string, LinearIssue>();
  private readonly sessions = new Map<string, AgentSessionRecord>();
  private readonly creations = new Map<string, LinearWrite>();
  private readonly teamIds: ReadonlyMap<string, string>;
  private readonly stateTypes: ReadonlyMap<string, LinearWorkflowState['type']>;
  private readonly workflowStates: LinearWorkflowState[];

  constructor(issues: readonly LinearIssue[] = [], options: FakeLinearOptions = {}) {
    const teams = new Map(Object.entries(options.teams ?? { [linearIssueFixture.teamKey]: linearIssueFixture.teamId }));
    for (const issue of issues) teams.set(issue.teamKey, issue.teamId);
    this.teamIds = teams;
    this.workflowStates = [...(options.workflowStates ?? workflowStatesFixture)].map(state => structuredClone(state));
    const states = new Map(this.workflowStates.map(state => [state.id, state.type]));
    for (const issue of issues) states.set(issue.stateId, issue.stateType);
    this.stateTypes = states;
    for (const issue of issues) this.issues.set(issue.id, structuredClone(issue));
  }

  private issue(id: string): LinearIssue {
    const issue = this.issues.get(id);
    if (!issue) throw new Error('Fake issue missing');
    return issue;
  }

  private sessionIssue(sessionId: string): LinearIssue {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Fake session missing');
    return this.issue(session.issueId);
  }

  async getIssue(id: string): Promise<LinearIssue> { return structuredClone(this.issue(id)); }

  async listIssues(teamKey: string, limit = 50): Promise<LinearIssue[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Linear issue limit must be 1..100');
    const teamId = this.teamIds.get(teamKey);
    return [...this.issues.values()].filter(issue => issue.teamId === teamId).slice(0, limit).map(issue => structuredClone(issue));
  }

  async listWorkflowStates(_teamKey: string): Promise<LinearWorkflowState[]> {
    return structuredClone(this.workflowStates);
  }

  async apply(write: LinearWrite): Promise<void> {
    if (write.kind === 'session') {
      const previous = this.sessions.get(write.session.id);
      if (previous) {
        if (previous.issueId !== write.session.issueId || previous.executionId !== write.session.executionId) throw new Error('Linear session ownership mismatch');
        return;
      }
      this.issue(write.session.issueId).sessions.push({ id: write.session.id, status: 'pending' });
      this.sessions.set(write.session.id, structuredClone(write.session));
    } else if (write.kind === 'state') {
      const issue = this.issue(write.issueId);
      const type = this.stateTypes.get(write.stateId);
      if (!type) throw new Error('Fake workflow state missing');
      issue.stateId = write.stateId;
      issue.stateType = type;
    } else if (write.kind === 'summary') {
      this.sessionIssue(write.sessionId);
    } else if (write.kind === 'attachment') {
      const issue = this.issue(write.issueId);
      if (!issue.resources.some(resource => resource.url === write.url)) issue.resources.push({ title: write.title ?? 'GitHub pull request', url: write.url });
    } else {
      const previous = this.creations.get(write.id);
      if (previous) {
        if (write.kind === 'activity' && (previous.kind !== 'activity' || previous.sessionId !== write.sessionId)) throw new Error('Linear activity ownership mismatch');
        if (write.kind === 'comment' && (previous.kind !== 'comment' || previous.issueId !== write.issueId)) throw new Error('Linear comment ownership mismatch');
        return;
      }
      if (write.kind === 'comment') this.issue(write.issueId).comments.push({ id: write.id, body: write.body });
      else this.sessionIssue(write.sessionId);
      this.creations.set(write.id, structuredClone(write));
    }
    this.writes.push(structuredClone(write));
  }

  async recordExecution(execution: Execution): Promise<void> {
    await this.apply({ kind: 'session', session: { id: execution.id, executionId: execution.id, issueId: execution.issueId } });
  }

  setIssueState(issueId: string, stateId: string): void {
    const issue = this.issue(issueId);
    const type = this.stateTypes.get(stateId);
    if (!type) throw new Error('Fake workflow state missing');
    issue.stateId = stateId;
    issue.stateType = type;
  }
}

export function fakeIssue(id = linearIssueFixture.id): LinearIssue { return { ...structuredClone(linearIssueFixture), id }; }
