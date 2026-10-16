import { createHash } from 'node:crypto';
import type { Evidence, Execution, Issue } from '@kor-code/core';

export interface TrackerIssue extends Issue {
  tracker?: "linear" | "github";
  repositoryKey?: string;
  /** Tracker supplies the exact PR linkage sentence. */
  pullRequestLink?: string;
  /** A provider status that cannot safely enter Kor's workflow. */
  intakeBlockedReason?: string;
  teamId: string;
  teamKey: string;
  stateId: string;
  stateType: TrackerStateType;
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
  /** The human key (`LEE-57`), link and state name, for display; `id` stays the stable tracker identity. */
  identifier?: string;
  url?: string;
  stateName?: string;
  milestoneId?: string;
}

/** Candidate rows omit execution context; hydrate once work is selected. */
export type TrackerIssueSummary = Omit<TrackerIssue, 'description' | 'acceptanceCriteria' | 'documents' | 'comments' | 'sessions' | 'resources'>;
export interface TrackerDocumentSummary { id: string; title: string; url: string }
export interface TrackerProjectSnapshot {
  id: string;
  name: string;
  url: string;
  milestones: Array<{ id: string; name: string; targetDate: string | null; sortOrder: number }>;
}
export function issueSummary(issue: TrackerIssue): TrackerIssueSummary {
  const { description, acceptanceCriteria, documents, comments, sessions, resources, ...summary } = issue;
  return summary;
}

export type TrackerStateType = "backlog" | "unstarted" | "started" | "completed" | "canceled" | "triage" | "duplicate";
export interface TrackerWorkflowState { id: string; type: TrackerStateType; name?: string }

export interface AgentSessionRecord {
  id: string;
  executionId: string;
  issueId: string;
}

// Stable UUIDs make remote creates replayable; state and summary writes are sets.
export type TrackerWrite =
  | { kind: 'session'; session: AgentSessionRecord }
  | { kind: 'state'; issueId: string; stateId: string }
  | { kind: 'label'; issueId: string; name: string; present: boolean }
  | { kind: 'summary'; sessionId: string; summary: string }
  | { kind: 'activity'; id: string; sessionId: string; activity: 'thought' | 'response' | 'error'; body: string }
  | { kind: 'comment'; id: string; issueId: string; body: string }
  | { kind: 'attachment'; issueId: string; url: string; title?: string };

export interface TrackerCapabilities { agentSessions?: boolean }

export interface TrackerClient {
  checkConnection?(): Promise<void>;
  listProjectDocuments?(projectId: string): Promise<TrackerDocumentSummary[]>;
  createProjectIssue?(input: { repositoryKey: string; id: string; title: string; description: string; labels: string[] }): Promise<TrackerIssue>;
  createIssue?(input: { id: string; teamKey: string; projectId: string; title: string; description: string; labels: string[] }): Promise<TrackerIssue>;
  setPriority?(issueId: string, priority: number): Promise<void>;
  fetchImage?(url: string, options?: { providerOnly?: boolean }): Promise<Response>;
  getIssue(id: string): Promise<TrackerIssue>;
  listIssues(teamKey: string, limit?: number): Promise<TrackerIssueSummary[]>;
  listProjectIssues?(projectId: string): Promise<TrackerIssueSummary[]>;
  getProject?(projectId: string): Promise<TrackerProjectSnapshot>;
  listWorkflowStates(teamKey: string): Promise<TrackerWorkflowState[]>;
  apply(write: TrackerWrite): Promise<void>;
  recordExecution(execution: Execution): Promise<void>;
  readonly capabilities?: TrackerCapabilities;
  supportsAgentSessions?(issueId: string): boolean;
}

export interface WorkflowMapping {
  /** Todo, deliberately never Backlog: Kor only starts opted-in work. */
  queued: TrackerWorkflowState;
  running: TrackerWorkflowState;
  complete: TrackerWorkflowState;
  review?: TrackerWorkflowState;
  canceled?: TrackerWorkflowState;
}
export interface Completion { summary: string; evidence: Evidence[]; pullRequestUrl?: string }

/** UUID-shaped deterministic IDs make comment/activity retries idempotent. */
export function stableId(namespace: string, key: string): string {
  const bytes = createHash('sha256').update(`${namespace}:${key}`).digest().subarray(0, 16);
  // Keep generated identifiers valid RFC 4122 UUID v4 values.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Tracker response has an invalid object');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Tracker response has an invalid string');
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Tracker response has an invalid list');
  return value;
}
export function stateType(value: unknown): TrackerStateType {
  const candidate = string(value);
  if (candidate === "backlog" || candidate === "unstarted" || candidate === "started" || candidate === "completed" || candidate === "canceled" || candidate === "triage" || candidate === "duplicate") return candidate;
  throw new Error("Tracker response has an invalid workflow state type");
}

function normalizedName(state: TrackerWorkflowState): string { return (state.name ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }

/** Resolve real team states by their names, with type-based fallbacks for custom workflows. */
export function workflowMapping(states: readonly TrackerWorkflowState[]): WorkflowMapping {
  const find = (predicate: (state: TrackerWorkflowState) => boolean): TrackerWorkflowState | undefined => states.find(predicate);
  const queued = find(state => /^(todo|to do)$/.test(normalizedName(state))) ?? find(state => state.type === 'unstarted' && normalizedName(state) !== 'backlog');
  const running = find(state => /^(in progress|started)$/.test(normalizedName(state))) ?? find(state => state.type === 'started' && !/review/.test(normalizedName(state)));
  const complete = find(state => /^(done|complete|completed)$/.test(normalizedName(state))) ?? find(state => state.type === 'completed');
  if (!queued || !running || !complete) throw new Error('Tracker workflow is missing Todo, In Progress, or Done');
  const review = find(state => /review/.test(normalizedName(state))) ?? find(state => state.type === 'started' && state.id !== running.id);
  const canceled = find(state => /^(canceled|cancelled)$/.test(normalizedName(state))) ?? find(state => state.type === 'canceled') ?? find(state => /^duplicate$/.test(normalizedName(state)));
  return { queued, running, complete, ...(review ? { review } : {}), ...(canceled ? { canceled } : {}) };
}
export function connection(value: unknown): unknown[] {
  const data = object(value);
  if (object(data.pageInfo).hasNextPage !== false) throw new Error('Tracker snapshot exceeds the connection limit; narrow the scope');
  return array(data.nodes);
}
