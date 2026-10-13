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
