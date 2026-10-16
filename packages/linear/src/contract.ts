import { createHash } from 'node:crypto';
import type { Evidence, Execution, Issue } from '@kor-code/core';

export interface LinearIssue extends Issue {
  teamId: string;
  teamKey: string;
  stateId: string;
  stateType: LinearStateType;
  updatedAt: string;
  priority: number;
  documents: Array<{ id: string; title: string; content: string }>;
  dependencies: Array<{ id: string; stateType: string }>;
  subIssueIds: string[];
  comments: Array<{ id: string; body: string }>;
  sessions: Array<{ id: string; status: string }>;
  resources: Array<{ title: string; url: string }>;
  /** Label names are used by the daemon's explicit intake opt-in. */
  labels: string[];
  /** The human key (`LEE-57`), link and state name, for display; `id` stays the stable UUID. */
  identifier?: string;
  url?: string;
  stateName?: string;
}

export type LinearStateType = "backlog" | "unstarted" | "started" | "completed" | "canceled" | "triage" | "duplicate";
export interface LinearWorkflowState { id: string; type: LinearStateType; name?: string }

export interface AgentSessionRecord {
  id: string;
  executionId: string;
  issueId: string;
}

// Stable UUIDs make remote creates replayable; state and summary writes are sets.
export type LinearWrite =
  | { kind: 'session'; session: AgentSessionRecord }
  | { kind: 'state'; issueId: string; stateId: string }
  | { kind: 'label'; issueId: string; name: string; present: boolean }
  | { kind: 'summary'; sessionId: string; summary: string }
  | { kind: 'activity'; id: string; sessionId: string; activity: 'thought' | 'response' | 'error'; body: string }
  | { kind: 'comment'; id: string; issueId: string; body: string }
  | { kind: 'attachment'; issueId: string; url: string; title?: string };

export interface LinearClientCapabilities { agentSessions?: boolean }

export interface LinearClient {
  createIssue?(input: { id: string; teamKey: string; projectId: string; title: string; description: string; labels: string[] }): Promise<LinearIssue>;
  setPriority?(issueId: string, priority: number): Promise<void>;
  fetchImage?(url: string): Promise<Response>;
  getIssue(id: string): Promise<LinearIssue>;
  listIssues(teamKey: string, limit?: number): Promise<LinearIssue[]>;
  listWorkflowStates(teamKey: string): Promise<LinearWorkflowState[]>;
  apply(write: LinearWrite): Promise<void>;
  recordExecution(execution: Execution): Promise<void>;
  readonly capabilities?: LinearClientCapabilities;
}

export interface WorkflowMapping {
  /** Todo, deliberately never Backlog: Kor only starts opted-in work. */
  queued: LinearWorkflowState;
  running: LinearWorkflowState;
  complete: LinearWorkflowState;
  review?: LinearWorkflowState;
  canceled?: LinearWorkflowState;
}
export interface Completion { summary: string; evidence: Evidence[]; pullRequestUrl?: string }

/** UUID-shaped deterministic IDs make comment/activity retries idempotent. */
export function stableId(namespace: string, key: string): string {
  const bytes = createHash('sha256').update(`${namespace}:${key}`).digest().subarray(0, 16);
  // Linear validates client supplied IDs as RFC 4122 UUID v4 values.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Linear response has an invalid object');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Linear response has an invalid string');
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Linear response has an invalid list');
  return value;
}
export function stateType(value: unknown): LinearStateType {
  const candidate = string(value);
  if (candidate === "backlog" || candidate === "unstarted" || candidate === "started" || candidate === "completed" || candidate === "canceled" || candidate === "triage" || candidate === "duplicate") return candidate;
  throw new Error("Linear response has an invalid workflow state type");
}

function normalizedName(state: LinearWorkflowState): string { return (state.name ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }

/** Resolve real team states by their names, with type-based fallbacks for custom workflows. */
export function workflowMapping(states: readonly LinearWorkflowState[]): WorkflowMapping {
  const find = (predicate: (state: LinearWorkflowState) => boolean): LinearWorkflowState | undefined => states.find(predicate);
  const queued = find(state => /^(todo|to do)$/.test(normalizedName(state))) ?? find(state => state.type === 'unstarted' && normalizedName(state) !== 'backlog');
  const running = find(state => /^(in progress|started)$/.test(normalizedName(state))) ?? find(state => state.type === 'started' && !/review/.test(normalizedName(state)));
  const complete = find(state => /^(done|complete|completed)$/.test(normalizedName(state))) ?? find(state => state.type === 'completed');
  if (!queued || !running || !complete) throw new Error('Linear team workflow is missing Todo, In Progress, or Done');
  const review = find(state => /review/.test(normalizedName(state))) ?? find(state => state.type === 'started' && state.id !== running.id);
  const canceled = find(state => /^(canceled|cancelled)$/.test(normalizedName(state))) ?? find(state => state.type === 'canceled') ?? find(state => /^duplicate$/.test(normalizedName(state)));
  return { queued, running, complete, ...(review ? { review } : {}), ...(canceled ? { canceled } : {}) };
}
export function connection(value: unknown): unknown[] {
  const data = object(value);
  if (object(data.pageInfo).hasNextPage !== false) throw new Error('Linear snapshot exceeds the connection limit; narrow the scope');
  return array(data.nodes);
}

export function parseIssue(value: unknown): LinearIssue {
  const data = object(value);
  const project = data.project === null ? undefined : object(data.project);
  const state = object(data.state);
  const description = data.description === null ? '' : string(data.description);
  const documents = [...connection(data.documents), ...(project ? connection(project.documents) : [])].map(value => {
    const document = object(value);
    return { id: string(document.id), title: string(document.title), content: document.content === null ? '' : string(document.content) };
  });
  const dependencies = connection(data.inverseRelations).flatMap(value => {
    const relation = object(value);
    if (relation.type !== 'blocks') return [];
    const issue = object(relation.issue);
    return [{ id: string(issue.id), stateType: stateType(object(issue.state).type) }];
  });
  if (typeof data.priority !== 'number' || !Number.isFinite(data.priority)) throw new Error('Linear priority is invalid');
  // Acceptance remains explicit in description; Jev owns interpretation/readiness.
  const acceptanceSection = /(?:^|\n)#{1,6}\s+Acceptance(?: criteria| conditions)?\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(description)?.[1] ?? '';
  return {
    id: string(data.id), title: string(data.title), description,
    acceptanceCriteria: acceptanceSection.split('\n').map(line => line.replace(/^\s*[-*]\s*(?:\[[ x]\]\s*)?/i, '').trim()).filter(Boolean),
    ...(project ? { projectId: string(project.id) } : {}),
    teamId: string(object(data.team).id), teamKey: string(object(data.team).key), stateId: string(state.id), stateType: stateType(state.type),
    ...(typeof data.identifier === 'string' ? { identifier: data.identifier } : {}), ...(typeof data.url === 'string' ? { url: data.url } : {}), ...(typeof state.name === 'string' ? { stateName: state.name } : {}),
    updatedAt: string(data.updatedAt), priority: data.priority, documents, dependencies,
    subIssueIds: connection(data.children).map(value => string(object(value).id)),
    comments: connection(data.comments).map(value => { const comment = object(value); return { id: string(comment.id), body: string(comment.body) }; }),
    sessions: connection(data.agentSessions).map(value => { const session = object(value); return { id: string(session.id), status: string(session.status) }; }),
    resources: connection(data.attachments).map(value => { const attachment = object(value); return { title: string(attachment.title), url: string(attachment.url) }; }),
    labels: data.labels === undefined ? [] : connection(data.labels).map(value => string(object(value).name)),
  };
}
