export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined }

export type ExecutionStatus = "queued" | "ready" | "evaluating" | "running" | "waiting" | "verifying" | "repairing" | "shipping" | "review" | "blocked" | "complete" | "failed" | "escalated";
export interface Issue { id: string; title: string; description?: string; acceptanceCriteria: string[]; projectId?: string; repository?: string }
export interface AcceptanceCondition { id: string; description: string; required: boolean }
export type AcceptanceStatus = "pending" | "pass" | "fail" | "unresolved";
export interface AcceptanceFinding { conditionId: string; status: AcceptanceStatus; evidenceIds: string[]; note?: string }
export interface RepositoryCheckResult { command: string; exitCode: number | null; output: string; status: "pass" | "fail"; note?: string }
export interface VerificationAttempt {
  attempt: number;
  checks: RepositoryCheckResult[];
  diff: string;
  evidence: Evidence[];
  findings: AcceptanceFinding[];
  blockers: string[];
  /** Exact repository paths observed during verification; shipping cannot discover extra files. */
  publication?: { baseRevision: string; paths: string[] };
}
export interface VerificationReport { attempts: VerificationAttempt[]; passed: boolean }
export interface AgentManifest { id: string; name: string; description?: string; skills: string[]; capabilities: string[]; acceptance: AcceptanceCondition[] }
export interface ExecutionManifest { executionId: string; issueId: string; repository: string; worktree: string; branch: string; agents: AgentManifest[]; acceptance: AcceptanceCondition[] }
export interface ContextSource { id: string; path: string; purpose: "rule" | "issue" | "document" | "decision" | "evidence"; relevance: number; content: string; truncated?: boolean }
export interface ContextSourceReference { id: string; path: string; purpose: ContextSource["purpose"] }
export interface ContextManifest { executionId: string; repository: string; worktree: string; sources: ContextSource[]; droppedSources: ContextSourceReference[]; compacted: boolean; redacted: boolean; relevanceOverride?: { source: "caller"; reason: string } }
export type ShippingStage =
  | { kind: "commit" }
  | { kind: "pipeline"; head: string; runId?: string }
  | { kind: "publish"; head: string }
  | { kind: "review" | "merged" | "closed"; mode: "no-mistakes" | "direct"; head: string; url: string; number: number; runId?: string };
export interface ShippingReport { stage: ShippingStage; evidence: Evidence[]; cleanup: "pending" | "removed"; error?: string }
export interface Execution { id: string; issueId: string; repository: string; worktree: string; branch: string; status: ExecutionStatus; route?: Route; manifest?: ExecutionManifest; verification?: VerificationReport; shipping?: ShippingReport }
export type AccountPolicy = "fill-first" | "manual" | "least-used";
export type ReasoningLevel = "low" | "medium" | "high";
export interface Route { provider: string; model: string; accountPolicy: AccountPolicy; sessionAffinity: boolean; reasoningLevel?: ReasoningLevel; label?: "jev" | "fallback" | "escalated"; decisionId?: string }
export interface CatalogueCapability { name: string; supported: boolean; details?: string }
export interface CatalogueModel { provider: string; model: string; capabilities: CatalogueCapability[]; available?: boolean; costUsd?: number; durationMs?: number }
export interface Evidence { id: string; kind: "test" | "review" | "provider" | "git" | "policy" | "linear"; summary: string; source?: string; status: "pass" | "fail" | "unresolved"; acceptanceId?: string; executionId?: string }
export interface DecisionInput { name: string; value: JsonValue; source?: string }
export interface DecisionBundle { decisionId: string; executionId: string; question: string; inputs: DecisionInput[]; choice: string; candidates: string[]; confidence: number; reasons: string[]; evidenceRefs: string[]; policyChecks: Array<{ name: string; result: "pass" | "fail" | "unresolved" }> }
export interface GatewayFacts { models: JsonValue; management: JsonValue | null; usage: JsonValue | null; quota: JsonValue | null; observedAt: string }

export type GatewayCapability = "streaming" | "tool_calls" | "thinking" | "structured_output";
export type AccountHealthStatus = "available" | "quota" | "authentication" | "unavailable" | "unknown";
export interface GatewayModel { id: string; provider?: string; capabilities: Partial<Record<GatewayCapability, boolean>>; compatibility: "verified" | "unverified" | "incompatible"; }
export interface GatewayAccountHealth { id: string; status: AccountHealthStatus; remainingQuota?: number | undefined; resetAt?: string | undefined; provider?: string | undefined; }
export type RouteFailureReason = "quota" | "rate_limit" | "authentication" | "provider_unavailable" | "capability" | "unknown";
export interface RouteTelemetry { provider: string; model: string; accountSlot?: string | undefined; accountSlotSource?: "health_observation" | undefined; sessionId?: string | undefined; requestId: string; decisionId?: string | undefined; failoverReason?: RouteFailureReason | undefined; retryCount: number; streamStarted: boolean; quotaResponse?: boolean | undefined; compatibility: GatewayModel["compatibility"]; }
/** Where a displayed value comes from. The cockpit labels every value that is not `live`; `fixture` is the README's "Illustrative". */
export type Provenance = "live" | "stale" | "fixture" | "unavailable";
/** A value an adapter hands the cockpit, with the provenance the cockpit must label it with. */
export interface Labelled<T> { value: T; provenance: Provenance; observedAt?: string; /** Why a value is stale or unavailable. */ reason?: string }

/** Stable read-only shape consumed by the cockpit and `kor status --json`. */
export type RunLifecycle = ExecutionStatus | "canceled";
/** Linux process identity plus the detached process group Kor created for it. */
export interface SessionProcessIdentity { pid: number; bootId: string; startTicks: string; pgid?: number }
export interface RunStatus {
  executionId: string;
  issueId: string;
  status: RunLifecycle;
  attempts: number;
  issueKey?: string;
  issueTitle?: string;
  issueUrl?: string;
  /** The Linear workflow state name as the daemon last read it. */
  issueState?: string;
  attemptId?: string;
  route?: Route;
  /** Where `route` came from: the configured default, Jev, the default after Jev escalated or was unavailable, or a cockpit override. */
  routeSource?: RouteSource;
  phase?: ExecutionStatus;
  verification?: VerificationReport;
  shipping?: ShippingReport;
  cancelRequested?: boolean;
  errorCode?: "execution_failed" | "verification_blocked" | "shipping_blocked" | "needs_input" | "canceled" | "recovered";
  pullRequestUrl?: string;
  /** Reported execution cost when persisted telemetry is available. */
  costUsd?: number;
  decisionIds?: string[];
  repository?: string;
  worktree?: string;
  branch?: string;
  sessionPid?: number;
  heartbeatAt?: string;
  error?: string;
  observedAt: string;
}
export interface KorStatusSnapshot {
  schemaVersion: 1;
  observedAt: string;
  daemon: { pid: number; startedAt: string; pollIntervalSeconds: number; lastPollAt?: string; lastError?: string };
  runs: RunStatus[];
  accounts?: Labelled<GatewayAccountHealth[]>;
  decisions?: Labelled<DecisionRecord[]>;
  /** The override audit, newest first. */
  overrides?: OverrideRecord[];
}
export type RouteSource = "config" | "jev" | "fallback" | "override";
/** A recorded Jev decision as the status reports it. */
export interface DecisionRecord extends DecisionBundle { kind: string; escalated: boolean; recordedAt: string }
/** A cockpit override as the daemon judged and audited it. */
export interface OverrideRecord {
  id: string;
  executionId: string;
  issueId: string;
  /** `route`, or the decision ID it overrides. */
  target: string;
  choice: string;
  previous?: string;
  status: "applied" | "rejected" | "reverted";
  reason: string;
  policyChecks: DecisionBundle["policyChecks"];
  origin: string;
  recordedAt: string;
  /** Whether the Linear comment reached the issue; a rejected override is never commented. */
  linearComment: "written" | "pending" | "failed" | "skipped";
}
export interface KorRunSnapshot { schemaVersion: 1; observedAt: string; run: RunStatus }
/** Selected execution contract for CLI supervisors. Missing measurements are null. */
export interface SupervisedRun {
  executionId: string;
  issueId: string;
  issueKey: string | null;
  state: RunLifecycle;
  attempts: number;
  cancelRequested: boolean;
  pullRequestUrl: string | null;
  needsInput: { reason: string } | null;
  costUsd: number | null;
}
export type KorExecutionStatusResponse =
  | { schemaVersion: 1; provenance: "live" | "stale"; observedAt: string; run: SupervisedRun; reason?: string }
  | { schemaVersion: 1; provenance: "unavailable"; observedAt: string; run: null; reason: string; error?: KorCliError };
export type StatusProvenance = "live" | "stale" | "unavailable";
export type KorStatusResponse =
  | { schemaVersion: 1; provenance: "live" | "stale"; observedAt: string; snapshot: KorStatusSnapshot; reason?: string }
  | { schemaVersion: 1; provenance: "unavailable"; observedAt: string; snapshot: null; reason: string; error?: KorCliError };

/** Stable machine-readable error returned by a failed Kor CLI command. */
export interface KorCliError {
  code: string;
  message: string;
  hint: string;
}
export interface KorCliErrorResponse { schemaVersion: 1; error: KorCliError }
