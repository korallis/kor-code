import { readFile } from 'node:fs/promises';
import type { Execution } from '@kor-code/core';
import { array, connection, object, parseIssue, string, type LinearClient, type LinearWrite } from './contract.js';

const page = 'pageInfo { hasNextPage }';
const issueFields = `id title description updatedAt priority team { id key } state { id type }
  labels { nodes { name } pageInfo { hasNextPage } }
  project { id documents(first: 100) { nodes { id title content } ${page} } }
  documents(first: 100) { nodes { id title content } ${page} }
  children(first: 100) { nodes { id } ${page} }
  comments(first: 100) { nodes { id body } ${page} }
  agentSessions(first: 100) { nodes { id status } ${page} }
  inverseRelations(first: 100) { nodes { type issue { id state { type } } } ${page} }
  attachments(first: 100) { nodes { title url } ${page} }`;

export interface LinearClientOptions {
  apiKey?: string;
  envFile?: string;
  fetcher?: typeof globalThis.fetch;
  // Write access is opt-in and also requires an app user for agent sessions.
  writes?: { appUserId: string };
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
export async function readBoundedJson(response: Response, maximum = 2_000_000): Promise<unknown> {
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
      if (size > maximum) throw new Error('Linear response exceeds size limit; upstream body redacted');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Linear response is invalid JSON; upstream body redacted'); }
  } finally { await reader.cancel(); }
}

export class HttpLinearClient implements LinearClient {
  constructor(private readonly options: LinearClientOptions = {}) {}

  async query(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const apiKey = this.options.apiKey ?? await resolveLinearApiKey(this.options.envFile);
    let response: Response;
    try {
      response = await (this.options.fetcher ?? globalThis.fetch)('https://api.linear.app/graphql', {
        method: 'POST', headers: { authorization: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Linear transport failed; upstream details redacted'); }
    const payload = object(await readBoundedJson(response));
    if (payload.errors !== undefined && array(payload.errors).length > 0) {
      throw new Error(`Linear GraphQL request failed: errors=${array(payload.errors).length}; upstream details redacted`);
    }
    return object(payload.data);
  }

  async getIssue(id: string) {
    const data = await this.query(`query KorIssue($id: String!) { issue(id: $id) { ${issueFields} } }`, { id });
    return parseIssue(data.issue);
  }

  async listIssues(teamKey: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Linear issue limit must be 1..100');
    const data = await this.query(`query KorIssues($key: String!, $first: Int!) {
      issues(first: $first, filter: { team: { key: { eq: $key } } }) { nodes { ${issueFields} } ${page} }
    }`, { key: teamKey, first: limit });
    // A candidate page is explicitly bounded, not a claim to read the whole backlog.
    return array(object(data.issues).nodes).map(parseIssue);
  }

  async apply(write: LinearWrite): Promise<void> {
    const writes = this.options.writes;
    if (!writes) throw new Error('Linear writes disabled');
    let data: Record<string, unknown>;
    switch (write.kind) {
      case 'session': {
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
        const existing = await this.query('query KorComment($id: String!) { comment(id: $id) { id issue { id } } }', { id: write.id });
        if (existing.comment !== null) {
          if (string(object(object(existing.comment).issue).id) !== write.issueId) throw new Error('Linear comment ownership mismatch');
          return;
        }
        data = await this.query('mutation KorComment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }', { input: { id: write.id, issueId: write.issueId, body: write.body } });
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
    teams(filter: { key: { eq: $key } }) { nodes { id } ${page} }
    workflowStates(filter: { team: { key: { eq: $key } } }) { nodes { id } ${page} }
    issues(first: 20, filter: { team: { key: { eq: $key } } }) { nodes { id } }
  }`, { key: teamKey });
  string(object(data.viewer).id);
  return { viewer: '1', teams: connection(data.teams).map(() => '1'), workflowStates: connection(data.workflowStates).map(() => '1'), issueCount: array(object(data.issues).nodes).length };
}
