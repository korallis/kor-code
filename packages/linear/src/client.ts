import { readFile } from 'node:fs/promises';
import type { Execution } from '@kor-code/core';
import { array, connection, object, parseIssue, parseIssueSummary, stableId, stateType, string, workflowMapping, type LinearClient, type LinearWrite, type LinearWorkflowState } from './contract.js';

const page = 'pageInfo { hasNextPage endCursor }';
const PAGE_SIZE = 50;
const summaryFields = `id identifier url title updatedAt priority team { id key } state { id type name } project { id }
  labels(first: 50) { nodes { name } ${page} }
  children(first: 50) { nodes { id } ${page} }
  inverseRelations(first: 50) { nodes { type issue { id state { type } } } ${page} }`;
const issueConnections = {
  labels: 'name', children: 'id', inverseRelations: 'type issue { id state { type } }',
  documents: 'id title content', comments: 'id body', agentSessions: 'id status', attachments: 'title url',
};

function nextCursor(value: unknown, previous: string | null): string | null {
  const info = object(object(value).pageInfo);
  if (info.hasNextPage === false) return null;
  if (info.hasNextPage !== true || typeof info.endCursor !== 'string' || !info.endCursor || info.endCursor === previous) throw new Error('Linear pagination did not advance');
  return info.endCursor;
}
function completeConnection(nodes: unknown[]) { return { nodes, pageInfo: { hasNextPage: false } }; }

export interface LinearClientOptions {
  apiKey?: string;
  envFile?: string;
  fetcher?: typeof globalThis.fetch;
  // Write access is opt-in and also requires an app user for agent sessions.
  writes?: { appUserId?: string };
  capabilities?: { agentSessions?: boolean };
}

export async function resolveLinearApiKey(envFile = `${process.env.HOME ?? ''}/.config/linear/env`): Promise<string> {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  try {
    const text = await readFile(envFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?LINEAR_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (match?.[1]) return match[1].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* Report no credential without revealing the path or file contents. */ }
  throw new Error('Linear credential unavailable');
}

// Discard upstream error bodies entirely. Neither HTTP nor GraphQL diagnostics
// can echo credentials, issue text, names, emails, or unbounded upstream content.
export async function readBoundedJson(response: Response, maximum = 2_000_000, context = 'unnamed query page 1'): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Linear request failed: HTTP ${response.status}; upstream body redacted`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Linear response is empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error(`Linear response exceeds size limit (${context}); upstream body redacted`);
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Linear response is invalid JSON; upstream body redacted'); }
  } finally { await reader.cancel(); }
}

export class HttpLinearClient implements LinearClient {
  readonly capabilities: { agentSessions: boolean };
  constructor(private readonly options: LinearClientOptions = {}) {
    this.capabilities = { agentSessions: options.capabilities?.agentSessions ?? false };
  }

  async checkConnection(): Promise<void> {
    const data = await this.query('query KorConnection { viewer { id } }');
    string(object(data.viewer).id);
  }

  async fetchImage(url: string): Promise<Response> {
    const asset = new URL(url);
    if (asset.protocol !== 'https:' || asset.hostname !== 'uploads.linear.app' || asset.username || asset.password || asset.port) throw new Error('Unsupported Linear image URL');
    const apiKey = this.options.apiKey ?? await resolveLinearApiKey(this.options.envFile);
    return (this.options.fetcher ?? globalThis.fetch)(asset, { headers: { authorization: apiKey }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  }

  async query(query: string, variables: Record<string, unknown> = {}, pageNumber = 1): Promise<Record<string, unknown>> {
    const apiKey = this.options.apiKey ?? await resolveLinearApiKey(this.options.envFile);
    let response: Response;
    try {
      response = await (this.options.fetcher ?? globalThis.fetch)('https://api.linear.app/graphql', {
        method: 'POST', headers: { authorization: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Linear transport failed; upstream details redacted'); }
    const operation = /^(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'unnamed';
    const payload = object(await readBoundedJson(response, 2_000_000, `${operation} page ${pageNumber}`));
    if (payload.errors !== undefined && array(payload.errors).length > 0) {
      const codes = array(payload.errors).map(error => {
        const value = object(error);
        const extensions = value.extensions === undefined ? undefined : object(value.extensions);
        return extensions?.code === undefined ? 'UNKNOWN' : string(extensions.code);
      });
      throw new Error(`Linear GraphQL request failed: errors=${codes.length}; codes=${[...new Set(codes)].join(',')}; upstream details redacted`);
    }
    return object(payload.data);
  }

  /** Walk one connection without retaining cursors or upstream bodies in diagnostics. */
  private async pages(query: string, variables: Record<string, unknown>, select: (data: Record<string, unknown>) => unknown): Promise<unknown[]> {
    const nodes: unknown[] = [];
    let after: string | null = null;
    let pageNumber = 0;
    do {
      const data = await this.query(query, { ...variables, after }, ++pageNumber);
      const result = select(data);
      nodes.push(...array(object(result).nodes));
      after = nextCursor(result, after);
    } while (after !== null);
    return nodes;
  }

  private async issueConnection(id: string, field: keyof typeof issueConnections, initial: unknown): Promise<unknown> {
    const nodes = [...array(object(initial).nodes)];
    let after = nextCursor(initial, null);
    let pageNumber = 1;
    while (after !== null) {
      const data = await this.query(`query KorIssueConnection($id: String!, $after: String) {
        issue(id: $id) { ${field}(first: ${field === 'documents' ? 1 : 20}, after: $after) { nodes { ${issueConnections[field]} } ${page} } }
      }`, { id, after }, ++pageNumber);
      const result = object(data.issue)[field];
      nodes.push(...array(object(result).nodes));
      after = nextCursor(result, after);
    }
    return completeConnection(nodes);
  }

  private async hydrateSummary(value: unknown) {
    const issue = object(value);
    const id = string(issue.id);
    for (const field of ['labels', 'children', 'inverseRelations'] as const) issue[field] = await this.issueConnection(id, field, issue[field]);
    return parseIssueSummary(issue);
  }

  async getIssue(id: string) {
    const data = await this.query(`query KorIssue($id: String!) { issue(id: $id) {
      ${summaryFields} description
      documents(first: 1) { nodes { id title content } ${page} }
      comments(first: 20) { nodes { id body } ${page} }
      agentSessions(first: 20) { nodes { id status } ${page} }
      attachments(first: 20) { nodes { title url } ${page} }
    } }`, { id });
    const issue = object(data.issue);
    for (const field of ['labels', 'children', 'inverseRelations', 'documents', 'comments', 'agentSessions', 'attachments'] as const) {
      issue[field] = await this.issueConnection(id, field, issue[field]);
    }
    if (issue.project !== null) {
      const project = object(issue.project);
      project.documents = completeConnection(await this.pages(`query KorProjectContext($id: String!, $after: String) {
        project(id: $id) { documents(first: 1, after: $after) { nodes { id title content } ${page} } }
      }`, { id: string(project.id) }, data => object(data.project).documents));
    }
    return parseIssue(issue);
  }

  async createIssue(input: Parameters<NonNullable<LinearClient['createIssue']>>[0]) {
    if (!this.options.writes) throw new Error('Linear writes disabled');
    const existing = await this.query(`query KorExistingIssue($id: ID!) { issues(first: 2, filter: { id: { eq: $id } }) { nodes { id team { key } project { id } } ${page} } }`, { id: input.id });
    const found = connection(existing.issues)[0];
    if (found !== undefined) {
      const issue = object(found);
      if (string(object(issue.team).key) !== input.teamKey || string(object(issue.project).id) !== input.projectId) throw new Error('Linear issue scope mismatch');
    } else {
      const scope = await this.query(`query KorIntakeScope($key: String!, $project: String!) {
        teams(first: 2, filter: { key: { eq: $key } }) { nodes { id } ${page} }
        project(id: $project) { id }
      }`, { key: input.teamKey, project: input.projectId });
      const teams = connection(scope.teams);
      if (teams.length !== 1) throw new Error('Linear team must resolve uniquely');
      const teamId = string(object(teams[0]).id);
      const project = object(scope.project);
      const projectTeams = await this.pages(`query KorProjectTeams($id: String!, $after: String) { project(id: $id) { teams(first: 50, after: $after) { nodes { id } ${page} } } }`, { id: string(project.id) }, data => object(data.project).teams);
      if (!projectTeams.some(team => string(object(team).id) === teamId)) throw new Error('Linear project does not belong to the configured team');
      const states = workflowMapping(await this.listWorkflowStates(input.teamKey));
      const data = await this.query('mutation KorCreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success } }', {
        input: { id: input.id, teamId, projectId: input.projectId, title: input.title, description: input.description, stateId: states.queued.id },
      });
      if (object(data.issueCreate).success !== true) throw new Error('Linear issue creation did not succeed');
    }
    // Label only after creation: incomplete intake remains out of the automatic queue.
    for (const name of input.labels) await this.apply({ kind: 'label', issueId: input.id, name, present: true });
    return this.getIssue(input.id);
  }

  async setPriority(issueId: string, priority: number): Promise<void> {
    if (!this.options.writes) throw new Error('Linear writes disabled');
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw new Error('Linear priority must be 0..4');
    const data = await this.query('mutation KorPriority($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: issueId, input: { priority } });
    if (object(data.issueUpdate).success !== true) throw new Error('Linear priority update did not succeed');
  }

  async listIssues(teamKey: string, pageSize = PAGE_SIZE) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Linear issue page size must be 1..100');
    const nodes = await this.pages(`query KorIssues($key: String!, $first: Int!, $after: String) {
      issues(first: $first, after: $after, filter: { team: { key: { eq: $key } } }) { nodes { ${summaryFields} } ${page} }
    }`, { key: teamKey, first: pageSize }, data => data.issues);
    const issues = [];
    for (const node of nodes) issues.push(await this.hydrateSummary(node));
    return issues;
  }

  async listWorkflowStates(teamKey: string): Promise<LinearWorkflowState[]> {
    const nodes = await this.pages(`query KorWorkflowStates($key: String!, $after: String) {
      workflowStates(first: 50, after: $after, filter: { team: { key: { eq: $key } } }) { nodes { id name type } ${page} }
    }`, { key: teamKey }, data => data.workflowStates);
    return nodes.map(value => {
      const state = object(value);
      return { id: string(state.id), name: string(state.name), type: stateType(state.type) };
    });
  }

  async listProjectIssues(projectId: string) {
    const nodes = await this.pages(`query KorProjectIssues($projectId: ID!, $after: String) {
      issues(first: 50, after: $after, filter: { project: { id: { eq: $projectId } } }) { nodes { ${summaryFields} } ${page} }
    }`, { projectId }, data => data.issues);
    const issues = [];
    for (const node of nodes) issues.push(await this.hydrateSummary(node));
    return issues;
  }

  async listProjectDocuments(projectId: string) {
    const nodes = await this.pages(`query KorProjectDocuments($id: String!, $after: String) {
      project(id: $id) { documents(first: 50, after: $after) { nodes { id title url } ${page} } }
    }`, { id: projectId }, data => object(data.project).documents);
    return nodes.map(value => { const document = object(value); return { id: string(document.id), title: string(document.title), url: string(document.url) }; });
  }

  async apply(write: LinearWrite): Promise<void> {
    const writes = this.options.writes;
    if (!writes) throw new Error('Linear writes disabled');
    let data: Record<string, unknown>;
    switch (write.kind) {
      case 'session': {
        if (!writes.appUserId || !this.capabilities.agentSessions) throw new Error('Linear agent-session writes disabled; use an OAuth app capability');
        // Reconcile stable IDs before replaying creates after a process crash.
        const existing = await this.query('query KorSession($id: String!) { agentSession(id: $id) { id issue { id } context } }', { id: write.session.id });
        if (existing.agentSession !== null) {
          const session = object(existing.agentSession);
          if (string(object(session.issue).id) !== write.session.issueId || object(session.context).executionId !== write.session.executionId) throw new Error('Linear session ownership mismatch');
          return;
        }
        data = await this.query('mutation KorSession($input: AgentSessionCreateInput!) { agentSessionCreate(input: $input) { success } }', {
          input: { id: write.session.id, issueId: write.session.issueId, appUserId: writes.appUserId, context: { executionId: write.session.executionId } },
        });
        break;
      }
      case 'state':
        data = await this.query('mutation KorState($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: write.issueId, input: { stateId: write.stateId } });
        break;
      case 'label': {
        const issue = await this.getIssue(write.issueId);
        if (issue.labels.includes(write.name) === write.present) return;
        const labels = await this.pages(`query KorLabels($name: String!, $after: String) {
          issueLabels(first: 50, after: $after, filter: { name: { eq: $name } }) { nodes { id team { id } } ${page} }
        }`, { name: write.name }, data => data.issueLabels);
        const candidates = labels.map(value => {
          const label = object(value);
          return { id: string(label.id), teamId: label.team === null ? undefined : string(object(label.team).id) };
        });
        let labelId = (candidates.find(label => label.teamId === issue.teamId) ?? candidates.find(label => label.teamId === undefined))?.id;
        if (!labelId) {
          if (!write.present) return;
          labelId = stableId('kor-label', `${issue.teamId}:${write.name}`);
          const created = await this.query('mutation KorLabel($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success } }', {
            input: { id: labelId, name: write.name, teamId: issue.teamId, color: '#EF4444' },
          });
          if (object(created.issueLabelCreate).success !== true) throw new Error('Linear label creation did not succeed');
        }
        data = await this.query('mutation KorIssueLabel($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', {
          id: write.issueId, input: write.present ? { addedLabelIds: [labelId] } : { removedLabelIds: [labelId] },
        });
        break;
      }
      case 'summary':
        data = await this.query('mutation KorSummary($id: String!, $input: AgentSessionUpdateInput!) { agentSessionUpdate(id: $id, input: $input) { success } }', { id: write.sessionId, input: { summary: write.summary } });
        break;
      case 'activity': {
        const existing = await this.query('query KorActivity($id: String!) { agentActivity(id: $id) { id agentSession { id } } }', { id: write.id });
        if (existing.agentActivity !== null) {
          if (string(object(object(existing.agentActivity).agentSession).id) !== write.sessionId) throw new Error('Linear activity ownership mismatch');
          return;
        }
        data = await this.query('mutation KorActivity($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }', {
          input: { id: write.id, agentSessionId: write.sessionId, content: { type: write.activity, body: write.body } },
        });
        break;
      }
      case 'comment': {
        const issue = await this.getIssue(write.issueId);
        const existing = issue.comments.find(comment => comment.id === write.id);
        if (existing?.body === write.body) return;
        if (existing) {
          data = await this.query('mutation KorCommentUpdate($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success } }', { id: write.id, input: { body: write.body } });
          break;
        }
        data = await this.query('mutation KorComment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }', { input: { id: write.id, issueId: write.issueId, body: write.body } });
        break;
      }
      case 'attachment': {
        const issue = await this.getIssue(write.issueId);
        if (issue.resources.some(resource => resource.url === write.url)) return;
        data = await this.query('mutation KorAttachment($issueId: String!, $url: String!, $title: String) { attachmentLinkGitHubPR(issueId: $issueId, url: $url, title: $title) { success } }', {
          issueId: write.issueId, url: write.url, ...(write.title ? { title: write.title } : {}),
        });
        break;
      }
    }
    if (!Object.values(data).some(value => object(value).success === true)) throw new Error('Linear mutation did not succeed');
  }

  async recordExecution(execution: Execution): Promise<void> {
    // The durable coordinator supplies a persisted session ID via apply instead.
    await this.apply({ kind: 'session', session: { id: execution.id, executionId: execution.id, issueId: execution.issueId } });
  }
}

export function createLinearClient(options: LinearClientOptions = {}): LinearClient { return new HttpLinearClient(options); }

// The foundation probe keeps its public shape, but all values are counts.
export interface LinearProbeResult { viewer: string; teams: string[]; workflowStates: string[]; issueCount: number }
export async function probeLinearReadOnly(fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<LinearProbeResult> {
  const client = new HttpLinearClient({ fetcher });
  const teamKey = process.env.LINEAR_TEAM_KEY ?? "LEE";
  const data = await client.query(`query KorReadOnlyProbe($key: String!) {
    viewer { id }
    teams(first: 2, filter: { key: { eq: $key } }) { nodes { id } ${page} }
  }`, { key: teamKey });
  string(object(data.viewer).id);
  const states = await client.listWorkflowStates(teamKey);
  const issues = await client.listIssues(teamKey);
  return { viewer: '1', teams: connection(data.teams).map(() => '1'), workflowStates: states.map(() => '1'), issueCount: issues.length };
}
