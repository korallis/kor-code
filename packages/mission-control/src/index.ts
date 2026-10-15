/** Browser-safe Mission Control protocol. No server modules execute on import. */
import type { KorConfig } from "@kor-code/config";
import type { CalibrationReport } from "@kor-code/calibration";
import type { LinearIssue } from "@kor-code/linear";
import type { DecisionRecord, GatewayAccountHealth, GatewayModel, JsonValue, KorStatusResponse, Labelled, OverrideRecord, RunStatus, VerificationAttempt, VerificationReport } from "@kor-code/core";
import type { RunMetric } from "@kor-code/calibration";

export const API_VERSION = 1;
export const API_PREFIX = "/api";
/** Send this header on EVERY /api request, including GET and the SSE fetch. */
export const TOKEN_HEADER = "authorization";
/** kor ui opens /#token=...; consume the fragment and remove it with replaceState.
 * Keep the token in memory/sessionStorage, never a query string or cookie.
 * Use fetch + ReadableStream for SSE: native EventSource cannot set headers.
 */
export type ApiErrorCode = "unauthorized" | "forbidden" | "invalid_request" | "not_found" | "conflict" | "unavailable" | "internal_error";
export interface ApiError { schemaVersion: 1; error: { code: ApiErrorCode; message: string; hint: string } }
export type ApiResult<T> = T | ApiError;
export type Stage = "discover" | "preflight" | "context" | "execute" | "supervise" | "verify" | "synchronise";
/** ISO-8601 times from durable records. Null means a historical time was never
 * recorded; never substitute observedAt for creation, execution or completion. */
export interface RunTimes {
  createdAt: string | null;
  updatedAt: string | null;
  /** Start of the latest execution attempt; reset when queued for another attempt. */
  startedAt: string | null;
  /** Terminal transition (complete/failed/canceled), cleared on retry. */
  completedAt: string | null;
}
export interface MissionVerificationAttempt extends VerificationAttempt {
  startedAt: string | null;
  completedAt: string | null;
}
export interface MissionVerificationReport extends Omit<VerificationReport, "attempts"> {
  attempts: MissionVerificationAttempt[];
}
/** Individual persisted measurements, including previous attempts. Compute
 * spend today from recordedAt, never from the run's cumulative cost or age. */
export type SpendRecord = Pick<RunMetric, "attempt" | "attemptId" | "recordedAt" | "model" | "costUsd" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens">;
export interface MissionRun extends Omit<RunStatus, "verification">, RunTimes {
  stage: Stage;
  needsInput: { reason: string } | null;
  accountSlot: Labelled<string | null>;
  verification?: MissionVerificationReport;
  /** Completion of the latest successful verification, independent of shipping. */
  verifiedAt: string | null;
  spend: Labelled<SpendRecord[]>;
}
export interface Project {
  id: string;
  name: string;
  repository: KorConfig["repos"][string];
  runs: MissionRun[];
}
export interface ProjectsResponse { schemaVersion: 1; projects: Project[] }
export interface RunsResponse { schemaVersion: 1; runs: MissionRun[] }
export interface RunResponse { schemaVersion: 1; run: MissionRun }
export interface TerminalResponse { schemaVersion: 1; executionId: string; content: string; offset: number }
export interface IssuesResponse { schemaVersion: 1; issues: Labelled<LinearIssue[]>; bounded: true }
export interface PullRequest { number: number; title: string; url: string; state: "open" | "closed"; draft: boolean; merged: boolean; head: string }
export interface PullsResponse { schemaVersion: 1; pulls: Labelled<PullRequest[]>; bounded: true }
export interface ModelsResponse { schemaVersion: 1; models: Labelled<GatewayModel[]> }
export interface PoolResponse { schemaVersion: 1; accounts: Labelled<GatewayAccountHealth[]>; quota: Labelled<JsonValue | null> }
export interface BrainResponse { schemaVersion: 1; decisions: Labelled<DecisionRecord[]>; calibration: Labelled<CalibrationReport | null>; learnings: Labelled<string[]> }
export interface ConnectionsResponse { schemaVersion: 1; connections: Connection[] }
export interface Connection { id: "linear" | "github" | "gateway" | "jev"; status: "connected" | "unavailable"; reason: string | null }
export interface ConfigResponse { schemaVersion: 1; config: KorConfig; restartRequired: boolean }
export interface QueueRequest { issueIds: [string, ...string[]] }
export interface QueueResponse { schemaVersion: 1; runs: MissionRun[] }
export interface MessageRequest { message: string }
/** `target` is `route`, `skills`, `playbook`, `tools` or a decision ID. Skill choices are
 * `skill:+NAME`, `skill:-NAME` or `skill:NAME=pinned|listed|armed|hidden`; a playbook choice
 * is its name or `none`; tool choices are `tool:+NAME` or `tool:-NAME`. `overBudget` accepts a
 * skill plan above the repository budget; it never widens the tool policy. */
export interface OverrideRequest { executionId: string; target: string; choice: string; decisionId?: string; overBudget?: boolean }
/** `tokens` is the selected guidance per turn before and after a skill or playbook edit. */
export interface OverrideResponse { schemaVersion: 1; record: OverrideRecord; tokens?: { before: number; after: number } | null }
/** One edit Mission Control can send: its per-turn token change, or why policy refuses it. */
export interface SessionOption { choice: string; tokenDelta: number | null; overBudget: boolean; blocked: string | null }
type SkillTier = "pinned" | "listed" | "armed" | "hidden";
/** The next session's guidance for an execution: Jev's latest plan with the overrides in force applied. */
export interface SessionPackResponse {
  schemaVersion: 1;
  executionId: string;
  /** False until Jev records a skills plan for the execution; edits then project onto an empty plan. */
  planned: boolean;
  budget: number;
  tokens: { pinned: number; listed: number; tool: number; total: number };
  skills: Array<{ name: string; tier: SkillTier; jevTier: SkillTier; probability: number; tokens: number; reason: string; options: SessionOption[] }>;
  playbook: { selected: string | null; jev: string | null; options: SessionOption[] };
  tools: { eligible: string[]; overrides: Array<{ name: string; present: boolean }>; options: SessionOption[] };
}
/** Pending writes remain durable and are retried by the daemon's Linear poll.
 * The count covers the daemon's entire outbox, including earlier actions. */
export type LinearSync = { status: "synced" } | { status: "pending"; pendingWrites: number };
export interface ActionResponse { schemaVersion: 1; executionId: string; accepted: true; run: MissionRun; linearSync: LinearSync }
export type ConnectRequest =
  | { provider: "linear"; apiKey: string }
  | { provider: "github"; token: string }
  | { provider: "gateway"; baseUrl: string; apiKey: string; managementKey?: string | undefined }
  | { provider: "jev"; apiKey: string };
/** Credentials are write-only and never appear in a response or event. */
export interface ProbeResponse { schemaVersion: 1; model: string; verified: boolean }
export interface AccountResponse { schemaVersion: 1; accountId: string; paused: boolean }
export type SuggestedAction =
  | { kind: "queue"; issueIds: [string, ...string[]]; label: string }
  | { kind: "retry" | "cancel" | "approve"; executionId: string; label: string }
  | { kind: "open-pr"; url: string; label: string }
  | { kind: "navigate"; screen: "home" | "projects" | "agents" | "models" | "brain" | "settings"; label: string };
export interface AskRequest { message: string; executionId?: string }
export interface AskResponse { schemaVersion: 1; id: string; answer: string; actions: SuggestedAction[] }
export type EventPayload =
  | { kind: "snapshot"; status: KorStatusResponse; runs: MissionRun[] }
  | { kind: "run"; run: MissionRun }
  | { kind: "stage"; executionId: string; stage: Stage }
  | { kind: "terminal"; executionId: string; channel: "stdout" | "stderr" | "daemon"; text: string; offset: number }
  | { kind: "decision"; decision: DecisionRecord }
  | { kind: "needs-input"; executionId: string; reason: string | null }
  | { kind: "pool"; accounts: Labelled<GatewayAccountHealth[]> }
  | { kind: "usage"; quota: Labelled<JsonValue | null> }
  | { kind: "ask"; response: AskResponse }
  | { kind: "config"; restartRequired: boolean }
  | { kind: "reset"; reason: string };
/** SSE event: message; id: <id>; data: JSON.stringify(MissionEvent).
 * Reconnect with Last-Event-ID. A reset precedes a fresh snapshot when history
 * expired or the daemon restarted. Heartbeats are SSE comments every 15s.
 */
export type MissionEvent = EventPayload & { schemaVersion: 1; id: string; observedAt: string };

type Endpoint<Request, Response> = { request: Request; response: ApiResult<Response> };
/** :id is an executionId, :project is a configured repository key. Encode path
 * segments with encodeURIComponent. All JSON writes require Content-Type JSON.
 * GET /api/linear/issues?project=<key>, /api/github/pulls?repo=<key>.
 */
export interface MissionControlApi {
  "GET /api/status": Endpoint<never, KorStatusResponse>;
  "GET /api/projects": Endpoint<never, ProjectsResponse>;
  "GET /api/runs": Endpoint<never, RunsResponse>;
  "GET /api/runs/:id": Endpoint<never, RunResponse>;
  "GET /api/runs/:id/terminal": Endpoint<never, TerminalResponse>;
  "GET /api/runs/:id/session": Endpoint<never, SessionPackResponse>;
  "GET /api/linear/issues": Endpoint<never, IssuesResponse>;
  "GET /api/github/pulls": Endpoint<never, PullsResponse>;
  "GET /api/models": Endpoint<never, ModelsResponse>;
  "GET /api/pool": Endpoint<never, PoolResponse>;
  "GET /api/quota": Endpoint<never, PoolResponse["quota"]>;
  "GET /api/brain": Endpoint<never, BrainResponse>;
  "GET /api/config": Endpoint<never, ConfigResponse>;
  "GET /api/connections": Endpoint<never, ConnectionsResponse>;
  "GET /api/events": Endpoint<never, MissionEvent>;
  "POST /api/runs": Endpoint<QueueRequest, QueueResponse>;
  "POST /api/runs/:id/cancel": Endpoint<Record<string, never>, ActionResponse>;
  "POST /api/runs/:id/retry": Endpoint<Record<string, never>, ActionResponse>;
  "POST /api/runs/:id/answer": Endpoint<MessageRequest, ActionResponse>;
  "POST /api/runs/:id/approve": Endpoint<Record<string, never>, ActionResponse>;
  "POST /api/runs/:id/request-changes": Endpoint<MessageRequest, ActionResponse>;
  "POST /api/runs/:id/note": Endpoint<MessageRequest, ActionResponse>;
  "POST /api/overrides": Endpoint<OverrideRequest, OverrideResponse>;
  "POST /api/overrides/:id/revert": Endpoint<Record<string, never>, OverrideResponse>;
  "POST /api/ask": Endpoint<AskRequest, AskResponse>;
  "PUT /api/config": Endpoint<KorConfig, ConfigResponse>;
  "PUT /api/projects/:project": Endpoint<KorConfig["repos"][string], ConfigResponse>;
  "POST /api/models/:id/probe": Endpoint<Record<string, never>, ProbeResponse>;
  "POST /api/accounts/:id/pause": Endpoint<Record<string, never>, AccountResponse>;
  "POST /api/accounts/:id/resume": Endpoint<Record<string, never>, AccountResponse>;
  "POST /api/connections": Endpoint<ConnectRequest, ConnectionsResponse>;
}
export type ApiRequest<K extends keyof MissionControlApi> = MissionControlApi[K]["request"];
export type ApiResponse<K extends keyof MissionControlApi> = MissionControlApi[K]["response"];
