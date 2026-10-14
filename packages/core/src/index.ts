export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined }

export type ExecutionStatus = "queued" | "ready" | "evaluating" | "running" | "waiting" | "verifying" | "repairing" | "review" | "blocked" | "complete" | "failed" | "escalated";
export interface Issue { id: string; title: string; description?: string; acceptanceCriteria: string[]; projectId?: string; repository?: string }
export interface AcceptanceCondition { id: string; description: string; required: boolean }
export type AcceptanceStatus = "pending" | "pass" | "fail" | "unresolved";
export interface AcceptanceFinding { conditionId: string; status: AcceptanceStatus; evidenceIds: string[]; note?: string }
export interface AgentManifest { id: string; name: string; description?: string; skills: string[]; capabilities: string[]; acceptance: AcceptanceCondition[] }
export interface ExecutionManifest { executionId: string; issueId: string; repository: string; worktree: string; branch: string; agents: AgentManifest[]; acceptance: AcceptanceCondition[] }
export interface ContextSource { id: string; path: string; purpose: "rule" | "issue" | "document" | "decision" | "evidence"; relevance: number; content: string; truncated?: boolean }
export interface ContextSourceReference { id: string; path: string; purpose: ContextSource["purpose"] }
export interface ContextManifest { executionId: string; repository: string; worktree: string; sources: ContextSource[]; droppedSources: ContextSourceReference[]; compacted: boolean; redacted: boolean; relevanceOverride?: { source: "caller"; reason: string } }
export interface Execution { id: string; issueId: string; repository: string; worktree: string; branch: string; status: ExecutionStatus; route?: Route; manifest?: ExecutionManifest }
export type AccountPolicy = "fill-first" | "manual" | "least-used";
export type ReasoningLevel = "low" | "medium" | "high";
export interface Route { provider: string; model: string; accountPolicy: AccountPolicy; sessionAffinity: boolean; reasoningLevel?: ReasoningLevel; label?: "jev" | "fallback" }
export interface CatalogueCapability { name: string; supported: boolean; details?: string }
export interface CatalogueModel { provider: string; model: string; capabilities: CatalogueCapability[]; available?: boolean }
export interface Evidence { id: string; kind: "test" | "review" | "provider" | "git" | "policy" | "linear"; summary: string; source?: string; status: "pass" | "fail" | "unresolved"; acceptanceId?: string; executionId?: string }
export interface DecisionInput { name: string; value: JsonValue; source?: string }
export interface DecisionBundle { decisionId: string; executionId: string; question: string; inputs: DecisionInput[]; choice: string; candidates: string[]; confidence: number; reasons: string[]; evidenceRefs: string[]; policyChecks: Array<{ name: string; result: "pass" | "fail" | "unresolved" }> }
export interface GatewayFacts { models: JsonValue; management: JsonValue | null; usage: JsonValue | null; quota: JsonValue | null; observedAt: string }

export type GatewayCapability = "streaming" | "tool_calls" | "thinking" | "structured_output";
export type AccountHealthStatus = "available" | "quota" | "authentication" | "unavailable" | "unknown";
export interface GatewayModel { id: string; provider?: string; capabilities: Partial<Record<GatewayCapability, boolean>>; compatibility: "verified" | "unverified" | "incompatible"; }
export interface GatewayAccountHealth { id: string; status: AccountHealthStatus; remainingQuota?: number | undefined; resetAt?: string | undefined; }
export type RouteFailureReason = "quota" | "rate_limit" | "authentication" | "provider_unavailable" | "capability" | "unknown";
export interface RouteTelemetry { provider: string; model: string; accountSlot?: string | undefined; accountSlotSource?: "health_observation" | undefined; sessionId?: string | undefined; requestId: string; decisionId?: string | undefined; failoverReason?: RouteFailureReason | undefined; retryCount: number; streamStarted: boolean; quotaResponse?: boolean | undefined; compatibility: GatewayModel["compatibility"]; }
/** Where a displayed value comes from. The cockpit labels every value that is not `live`; `fixture` is the README's "Illustrative". */
export type Provenance = "live" | "stale" | "fixture" | "unavailable";
/** A value an adapter hands the cockpit, with the provenance the cockpit must label it with. */
export interface Labelled<T> { value: T; provenance: Provenance; observedAt?: string }
