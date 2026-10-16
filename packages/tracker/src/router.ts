import type { KorConfig } from '@kor-code/config';
import type { Execution } from '@kor-code/core';
import type { TrackerClient, TrackerWrite } from './contract.js';
import { GitHubTracker, type GitHubRequest } from './github.js';

/** Routes once at the tracker boundary; engine callers use only this contract. */
export class TrackerRouter implements TrackerClient {
  readonly github: GitHubTracker[];
  constructor(private readonly config: KorConfig, private readonly linear: TrackerClient, request: GitHubRequest) {
    this.github = Object.entries(config.repos).flatMap(([key, repository]) => repository.tracker === 'github' && repository.github ? [new GitHubTracker(key, repository.github, request)] : []);
  }
  private client(reference: string): { client: TrackerClient; reference: string } {
    if (reference.startsWith('project:')) {
      const key = reference.slice('project:'.length);
      const repository = this.config.repos[key];
      if (!repository) throw new Error('Unknown configured tracker project');
      if (repository.tracker === 'github') {
        const github = this.github.find(client => client.repositoryKey === key);
        if (!github) throw new Error('GitHub tracker settings missing');
        return { client: github, reference: github.scope };
      }
      return { client: this.linear, reference: repository.linearTeam ?? key.split('/')[0] ?? key };
    }
    const exact = this.github.find(client => reference === client.scope || reference.startsWith(`${client.scope}#`));
    if (exact) return { client: exact, reference };
    const match = /^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)(?:\/issues\/|#)([1-9][0-9]*)$/.exec(reference);
    if (match) {
      const candidates = this.github.filter(client => client.settings.repository.toLowerCase() === match[1]?.toLowerCase());
      if (candidates.length !== 1) throw new Error('Use the configured GitHub issue ID when the repository belongs to multiple Kor projects');
      const client = candidates[0];
      if (client) return { client, reference: `${client.scope}#${match[2]}` };
    }
    if (reference.startsWith('github:') || reference.startsWith('#')) throw new Error('GitHub issue needs its configured repository-qualified ID');
    return { client: this.linear, reference };
  }
  supportsAgentSessions(issueId: string): boolean { return this.client(issueId).client.capabilities?.agentSessions === true; }
  get capabilities() { return { agentSessions: false }; }
  getIssue(reference: string) { const target = this.client(reference); return target.client.getIssue(target.reference); }
  async listIssues(scope: string, limit?: number) {
    const target = this.client(scope);
    const repository = scope.startsWith('project:') ? this.config.repos[scope.slice('project:'.length)] : undefined;
    if (repository?.tracker === 'linear' && repository.linearProject) {
      if (this.linear.listProjectIssues) return this.linear.listProjectIssues(repository.linearProject);
      return (await this.linear.listIssues(target.reference, limit)).filter(issue => issue.projectId === repository.linearProject);
    }
    return target.client.listIssues(target.reference, limit);
  }
  listWorkflowStates(scope: string) { const target = this.client(scope); return target.client.listWorkflowStates(target.reference); }
  async listProjectDocuments(scope: string) {
    const { client } = this.client(scope);
    const repository = scope.startsWith('project:') ? this.config.repos[scope.slice(8)] : undefined;
    return repository?.linearProject && client.listProjectDocuments ? client.listProjectDocuments(repository.linearProject) : [];
  }
  async createProjectIssue(input: { repositoryKey: string; id: string; title: string; description: string; labels: string[] }) {
    const repository = this.config.repos[input.repositoryKey];
    if (!repository) throw new Error('Configured tracker project not found');
    if (repository.tracker === 'linear' && !repository.linearProject) throw new Error('Set the Linear project in Settings before creating work');
    return this.createIssue({ ...input, teamKey: `project:${input.repositoryKey}`, projectId: repository.linearProject ?? input.repositoryKey });
  }
  async createIssue(input: Parameters<NonNullable<TrackerClient['createIssue']>>[0]) {
    const { client, reference } = this.client(input.teamKey);
    if (!client.createIssue) throw new Error('Tracker issue creation unavailable');
    return client.createIssue({ ...input, teamKey: reference });
  }
  async setPriority(reference: string, priority: number) {
    const target = this.client(reference);
    if (!target.client.setPriority) throw new Error('Tracker priority changes unavailable');
    await target.client.setPriority(target.reference, priority);
  }
  async apply(write: TrackerWrite) {
    const reference = 'issueId' in write ? write.issueId : write.kind === 'session' ? write.session.issueId : undefined;
    await (reference ? this.client(reference).client : this.linear).apply(write);
  }
  async recordExecution(execution: Execution) { await this.client(execution.issueId).client.recordExecution(execution); }
  async attachImage(reference: string, bytes: Buffer, alt: string) {
    const target = this.client(reference);
    if (!(target.client instanceof GitHubTracker)) throw new Error('Use kor linear attach-image for a Linear issue');
    return target.client.attachImage(target.reference, bytes, alt);
  }
  async fetchImage(url: string) {
    const asset = new URL(url);
    const github = this.github.find(client => asset.hostname === 'raw.githubusercontent.com' && asset.pathname.toLowerCase().startsWith(`/${client.settings.repository.toLowerCase()}/`));
    if (github) return github.fetchImage(url);
    if (asset.hostname === 'uploads.linear.app' && this.linear.fetchImage) return this.linear.fetchImage(url);
    return fetch(asset, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  }
}
