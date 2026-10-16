import type { CatalogueModel } from "@kor-code/core";
import type { JevJsonValue } from "./contracts.js";

/** Operator routing policy, not a benchmark or a claim about provider prices. */
export const ROUTING_POLICY_VERSION = "jev-routing-3";
export type ReasoningClass = "routine" | "implementation" | "deep";
interface ModelProfile {
  reasoningClass: ReasoningClass;
  strengths: string;
  avoid: string;
  costTier: "economy" | "balanced" | "premium";
  speed: "fast" | "balanced" | "deliberate";
}
// Exact identities deliberately avoid assigning new releases an unverified quality tier.
const profiles: Record<string, ModelProfile> = {
  "claude-haiku-5-5": { reasoningClass: "routine", strengths: "Small mechanical edits, isolated configuration changes, documentation with explicit steps.", avoid: "Diagnosis, interacting domain invariants, authorization or architectural decisions.", costTier: "economy", speed: "fast" },
  "claude-sonnet-5-5": { reasoningClass: "implementation", strengths: "UI behavior, full-stack feature integration, user-facing workflows and documentation.", avoid: "Prefer the backend implementation role for a change confined to data processing, an API or a precise code invariant.", costTier: "balanced", speed: "balanced" },
  "gpt-6.1-sol": { reasoningClass: "implementation", strengths: "Backend APIs, data processing, bounded bug fixes, precise invariants and refactoring in an existing design.", avoid: "Prefer the UI integration role when the primary deliverable is a screen or interactive user workflow.", costTier: "balanced", speed: "balanced" },
  "claude-fable-5-1": { reasoningClass: "deep", strengths: "Open-ended research, discovery and comparing unresolved technical approaches before implementation.", avoid: "A specified implementation or an independent correctness/security review has a more specific role.", costTier: "premium", speed: "deliberate" },
  "claude-opus-5-5": { reasoningClass: "deep", strengths: "Large implementation spanning modules, migrations and interacting workflows with a defined outcome.", avoid: "Reviewing, landing or merging an already implemented PR belongs to the correctness-review role, even when its existing feature spans modules; prefer research for unresolved approach selection.", costTier: "premium", speed: "deliberate" },
  "gpt-6-astra": { reasoningClass: "deep", strengths: "Reviewing, landing or merging an already implemented PR; independent correctness review, security/authorization analysis, production data integrity and high-risk diagnosis.", avoid: "Prefer the large implementation role for specified feature construction, or research for open-ended discovery.", costTier: "premium", speed: "deliberate" },
};
const reviewerRoles: Record<string, { strengths: string; avoid: string }> = {
  "claude-haiku-5-5": { strengths: "Mechanical diff and formatting review with no interacting invariants.", avoid: "Security, data integrity and multi-module correctness review." },
  "claude-sonnet-5-5": { strengths: "UI behavior, accessibility and interactive workflow review.", avoid: "Prefer broad correctness review for authorization, migrations and production integrity." },
  "gpt-6.1-sol": { strengths: "Bounded backend/API implementation review within an established design.", avoid: "Prefer adversarial review for high-risk cross-system correctness." },
  "claude-fable-5-1": { strengths: "Challenge unresolved architectural approaches and research assumptions.", avoid: "Prefer correctness review when assessing an existing implementation against specified acceptance criteria." },
  "claude-opus-5-5": { strengths: "Broad independent implementation correctness review: domain invariants, migrations, authorization and production integrity. Default correctness-review role when the adversarial role is excluded by writer independence.", avoid: "Prefer UI workflow review if the only obligation is visual/interactive behavior, or research challenge for unresolved architecture." },
  "gpt-6-astra": { strengths: "Adversarial independent correctness, security, authorization and production data integrity review. Preferred correctness-review role when available independently of the writer.", avoid: "Prefer UI workflow review for visual-only review or research challenge for unresolved approaches." },
};
export const reasoningCriteria = {
  routine: "An explicit mechanical edit, documentation or configuration task with known steps, no diagnosis, no interacting domain rules, and no security/data-integrity decision. Scope may include several identical edits.",
  implementation: "A bounded feature or fix within an established design: API/data processing, UI integration or a precise local invariant. Requires coding and verification but no unresolved architecture, high-risk authorization/data-integrity analysis or broad production investigation.",
  deep: "Unresolved architecture/research, multi-module implementation with interacting invariants, independent review, or high-risk security/authorization/production data-integrity diagnosis. Operational execution alone is not deep when steps are explicit and reversible.",
} satisfies Record<ReasoningClass, string>;
export function modelProfile(model: CatalogueModel, purpose: "implementation" | "review" = "implementation"): JevJsonValue {
  const profile = profiles[model.model];
  return {
    policyVersion: ROUTING_POLICY_VERSION,
    ...(profile ? { ...profile, provenance: "maintained operator routing policy; reasoning quality is not measured by the capability probe" } : { reasoningClass: "unknown", strengths: "No maintained capability profile. Do not infer reasoning quality from the model name.", provenance: "unprofiled" }),
    ...(purpose === "review" && reviewerRoles[model.model] ? reviewerRoles[model.model] : {}),
    purpose,
    contextWindowTokens: null, contextEvidence: "Not measured by the registry; do not assume a context limit.",
    capabilities: Object.fromEntries(model.capabilities.map(capability => [capability.name, capability.supported])),
    provider: model.provider,
    observations: { probeCostUsd: model.costUsd ?? null, probeDurationMs: model.durationMs ?? null, basis: "One capability probe; not a provider price, quality score, context measurement or workload latency prediction." },
  };
}
export function modelCriteria(models: readonly CatalogueModel[], purpose: "implementation" | "review" = "implementation"): Record<string, JevJsonValue> {
  return Object.fromEntries(models.map(model => [model.model, modelProfile(model, purpose)]));
}
export function isRoutableModel(model: CatalogueModel): boolean {
  return model.available !== false && profiles[model.model] !== undefined
    && ["streaming", "tool_calls", "structured_output"].every(name => model.capabilities.some(capability => capability.name === name && capability.supported));
}
export function modelsForClass(models: readonly CatalogueModel[], reasoningClass: string): CatalogueModel[] {
  return models.filter(model => isRoutableModel(model) && profiles[model.model]?.reasoningClass === reasoningClass);
}
export function modelReasoningClass(model: string): ReasoningClass | undefined { return profiles[model]?.reasoningClass; }
export function conservativeModel(models: readonly CatalogueModel[]): CatalogueModel | undefined {
  return [...models].filter(isRoutableModel).sort((a, b) => {
    const rank = (model: CatalogueModel) => profiles[model.model]?.reasoningClass === "deep" ? 0 : profiles[model.model]?.reasoningClass === "implementation" ? 1 : 2;
    return rank(a) - rank(b) || Number(b.model === "gpt-6-astra") - Number(a.model === "gpt-6-astra") || a.model.localeCompare(b.model);
  })[0];
}
