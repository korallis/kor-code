export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined }

export type ExecutionStatus = "queued" | "ready" | "evaluating" | "running" | "waiting" | "verifying" | "repairing" | "review" | "blocked" | "complete" | "failed" | "escalated";
export interface Issue { id: string; title: string; description?: string; acceptanceCriteria: string[]; projectId?: string; repository?: string }
export interface AcceptanceCondition { id: string; description: string; required: boolean }
export interface AgentManifest { id: string; name: string; description?: string; skills: string[]; capabilities: string[]; acceptance: AcceptanceCondition[] }
export interface ExecutionManifest { executionId: string; issueId: string; repository: string; worktree: string; branch: string; agents: AgentManifest[]; acceptance: AcceptanceCondition[] }
export interface Execution { id: string; issueId: string; repository: string; worktree: string; branch: string; status: ExecutionStatus; route?: Route; manifest?: ExecutionManifest }
export type AccountPolicy = "fill-first" | "manual" | "least-used";
export type ReasoningLevel = "low" | "medium" | "high";
export interface Route { provider: string; model: string; accountPolicy: AccountPolicy; sessionAffinity: boolean; reasoningLevel?: ReasoningLevel }
export interface CatalogueCapability { name: string; supported: boolean; details?: string }
export interface CatalogueModel { provider: string; model: string; capabilities: CatalogueCapability[]; available?: boolean }
export interface Evidence { id: string; kind: "test" | "review" | "provider" | "git" | "policy" | "linear"; summary: string; source?: string; status: "pass" | "fail" | "unresolved" }
export interface DecisionInput { name: string; value: JsonValue; source?: string }
export interface DecisionBundle { decisionId: string; executionId: string; question: string; inputs: DecisionInput[]; choice: string; candidates: string[]; confidence: number; reasons: string[]; evidenceRefs: string[]; policyChecks: Array<{ name: string; result: "pass" | "fail" | "unresolved" }> }
export interface GatewayFacts { models: JsonValue; management: JsonValue | null; usage: JsonValue | null; quota: JsonValue | null; observedAt: string }
