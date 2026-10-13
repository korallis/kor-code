export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined }

export type ExecutionStatus = "queued" | "evaluating" | "running" | "waiting" | "verifying" | "repairing" | "complete" | "failed" | "escalated";
export interface Issue { id: string; title: string; description?: string; acceptanceCriteria: string[]; projectId?: string; repository?: string }
export interface Execution { id: string; issueId: string; repository: string; worktree: string; branch: string; status: ExecutionStatus; route?: Route }
export interface Route { provider: string; model: string; accountPolicy: "fill-first" | "manual" | "least-used"; sessionAffinity: boolean; reasoningLevel?: "low" | "medium" | "high" }
export interface Evidence { id: string; kind: "test" | "review" | "provider" | "git" | "policy" | "linear"; summary: string; source?: string; status: "pass" | "fail" | "unresolved" }
export interface DecisionBundle { decisionId: string; executionId: string; question: string; choice: string; candidates: string[]; confidence: number; reasons: string[]; evidenceRefs: string[]; policyChecks: Array<{ name: string; result: "pass" | "fail" | "unresolved" }> }
export interface GatewayFacts { models: JsonValue; management: JsonValue | null; usage: JsonValue | null; quota: JsonValue | null; observedAt: string }

export type GatewayCapability = "streaming" | "tool_calls" | "thinking" | "structured_output";
export type AccountHealthStatus = "available" | "quota" | "authentication" | "unavailable" | "unknown";
export interface GatewayModel { id: string; provider?: string; capabilities: Partial<Record<GatewayCapability, boolean>>; compatibility: "verified" | "unverified" | "incompatible"; }
export interface GatewayAccountHealth { id: string; status: AccountHealthStatus; remainingQuota?: number | undefined; resetAt?: string | undefined; }
export type RouteFailureReason = "quota" | "rate_limit" | "authentication" | "provider_unavailable" | "capability" | "unknown";
export interface RouteTelemetry { provider: string; model: string; accountSlot?: string | undefined; accountSlotSource?: "health_observation" | undefined; sessionId?: string | undefined; requestId: string; decisionId?: string | undefined; failoverReason?: RouteFailureReason | undefined; retryCount: number; streamStarted: boolean; quotaResponse?: boolean | undefined; compatibility: GatewayModel["compatibility"]; }
