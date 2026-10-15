import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { JevUnavailableError, type JevClient } from "./client.js";
import { parseResponse, type JevJsonValue, type JevQuestion } from "./contracts.js";
import type { AppliedDecision, DecisionAuditLog, DecisionRequest } from "./index.js";

const NONE = "none-needed";
const MAX_CANDIDATES = 100;
export const SKILL_TOOL_TOKENS = 636;
export const DEFAULT_SKILL_THRESHOLDS = { pinned: 0.8, listed: 0.25, armed: 0.15 };
const MAX_PINNED = 2;
const MAX_LISTED = 4;
const MAX_ARMED = 2;
const MAX_PINNED_TOKENS = 3_000;
export const MAX_BODY_TOKENS = 2_000;
export const MAX_ARMED_BODY_TOKENS = 1_500;
export const DEFAULT_SKILL_BUDGET = 4_000;
export const MIN_SKILL_SAMPLES = 20;
const MAX_HISTORY = 8;
export const skillLearningSchema = z.object({
  samples: z.number().int().nonnegative(), offered: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(), used: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1).nullable(), lift: z.number().min(-1).max(1).nullable(),
  demoted: z.boolean(),
  thresholds: z.object({ pinned: z.number().min(0).max(1), listed: z.number().min(0).max(1), armed: z.number().min(0).max(1) }),
});
export type SkillLearning = z.infer<typeof skillLearningSchema>;

export const skillCandidateSchema = z.object({
  hash: z.string().optional(), name: z.string(), kind: z.string(), stages: z.array(z.string()), summary: z.string(),
  triggers: z.array(z.string()), anti: z.array(z.string()), requires: z.array(z.string()),
  visibility: z.enum(["public", "local-only"]), jevVisible: z.enum(["full", "names-only"]),
  stackTags: z.array(z.string()).optional(),
  cost: z.object({ listingTokens: z.number().int().nonnegative(), bodyTokens: z.number().int().nonnegative() }),
});
export type SkillCandidate = z.infer<typeof skillCandidateSchema>;
export interface SkillsInput {
  executionId: string;
  task: string;
  stage: string;
  catalogue: { hash: string; skills: readonly SkillCandidate[] };
  allowedTools: readonly string[];
  stackTags?: readonly string[];
  always?: readonly string[];
  pins?: readonly string[];
  never?: readonly string[];
  budget?: number;
  listingBudget?: number;
  bodyBudget?: number;
  learning?: Readonly<Record<string, SkillLearning>>;
}
const tokens = z.number().int().nonnegative();
export const skillPlanSchema = z.object({
  catalogueHash: z.string(), source: z.enum(["jev", "fallback"]), budget: tokens,
  tokens: z.object({ pinned: tokens, listed: tokens, tool: tokens, total: tokens }),
  skills: z.array(z.object({ hash: z.string().optional(), name: z.string(), tier: z.enum(["pinned", "listed", "armed", "hidden"]), probability: z.number().min(0).max(1), tokens, reason: z.string() })),
  selection: z.object({
    calls: tokens, durationMs: z.number().nonnegative(), callDurationMs: z.array(z.number().nonnegative()),
    inputTokens: tokens, outputTokens: tokens, usageReported: z.boolean(),
    samples: z.array(z.object({
      order: z.array(z.string()),
      answer: z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number(), probabilities: z.record(z.string(), z.number()) }),
    })),
  }),
});
export type SkillPlan = z.infer<typeof skillPlanSchema>;

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function ordered(names: string[], seed: string): string[] {
  return [...names].sort((a, b) => digest([seed, a]).localeCompare(digest([seed, b])));
}
/** Why policy keeps a skill out of this session's plan, or undefined when it may load. */
export function filteredReason(skill: SkillCandidate, input: Pick<SkillsInput, "never" | "stage" | "allowedTools" | "stackTags" | "learning" | "always" | "pins">): string | undefined {
  if (input.never?.includes(skill.name)) return "Denied by repository policy.";
  if (input.learning?.[skill.name]?.demoted && !input.always?.includes(skill.name) && !input.pins?.includes(skill.name)) return "Hidden by outcome learning: never loaded in the recent offer window.";
  if (skill.kind === "playbook") return "Playbooks have a separate decision.";
  if (skill.stages.length && !skill.stages.includes(input.stage)) return "Not available at this stage.";
  const tools = new Set(input.allowedTools.map(tool => tool.split("(")[0]));
  if (skill.requires.some(tool => !tools.has(tool))) return "Requires unavailable tools.";
  if (skill.stackTags?.length && !skill.stackTags.some(tag => input.stackTags?.includes(tag))) return "Repository stack does not match.";
  return undefined;
}
function makePlan(input: SkillsInput, probabilities: Record<string, number>, source: SkillPlan["source"], selection: SkillPlan["selection"]): SkillPlan {
  const budget = input.budget ?? DEFAULT_SKILL_BUDGET;
  const bodyLimit = Math.min(input.bodyBudget ?? MAX_BODY_TOKENS, MAX_BODY_TOKENS);
  const plan: SkillPlan = { catalogueHash: input.catalogue.hash, source, budget, tokens: { pinned: 0, listed: 0, tool: 0, total: 0 }, skills: [], selection };
  let pinned = 0, listed = 0, armed = 0;
  const forced = (skill: SkillCandidate) => input.always?.includes(skill.name) || source === "jev" && input.pins?.includes(skill.name);
  const skills = [...input.catalogue.skills].sort((a, b) => Number(Boolean(forced(b))) - Number(Boolean(forced(a))) || (probabilities[b.name] ?? 0) - (probabilities[a.name] ?? 0) || a.name.localeCompare(b.name));
  for (const skill of skills) {
    const probability = probabilities[skill.name] ?? 0;
    const thresholds = input.learning?.[skill.name]?.thresholds ?? DEFAULT_SKILL_THRESHOLDS;
    let reason = filteredReason(skill, input);
    let tier: SkillPlan["skills"][number]["tier"] = "hidden";
    if (!reason && source === "fallback" && !input.always?.includes(skill.name)) reason = "Fallback loads repository always skills only.";
    if (!reason && !forced(skill) && (probabilities[NONE] ?? 0) >= 0.5) reason = "Jev judged that no skill is needed.";
    if (!reason) {
      if ((forced(skill) || probability >= thresholds.pinned) && skill.cost.bodyTokens <= bodyLimit) {
        if (pinned < MAX_PINNED && plan.tokens.pinned + skill.cost.bodyTokens <= MAX_PINNED_TOKENS && plan.tokens.total + skill.cost.bodyTokens <= budget) {
          tier = "pinned";
          pinned++;
          plan.tokens.pinned += skill.cost.bodyTokens;
          plan.tokens.total += skill.cost.bodyTokens;
        } else reason = "Pinned count or token budget exceeded.";
      } else if (forced(skill)) reason = "Repository pin exceeds the per-body budget.";
      else if (probability >= thresholds.listed && skill.cost.listingTokens > 0) {
        const tool = listed ? 0 : SKILL_TOOL_TOKENS;
        if (listed < MAX_LISTED && plan.tokens.listed + skill.cost.listingTokens <= (input.listingBudget ?? budget) && plan.tokens.total + skill.cost.listingTokens + tool <= budget) {
          tier = "listed";
          listed++;
          plan.tokens.listed += skill.cost.listingTokens;
          plan.tokens.tool += tool;
          plan.tokens.total += skill.cost.listingTokens + tool;
        } else reason = "Listing count or token budget exceeded.";
      } else if (probability >= thresholds.armed && skill.triggers.length && skill.cost.bodyTokens <= MAX_ARMED_BODY_TOKENS) {
        if (armed < MAX_ARMED) { tier = "armed"; armed++; }
        else reason = "Armed count exceeded.";
      } else reason = "Below tier thresholds or unsuitable body/listing cost.";
    }
    plan.skills.push({ ...(skill.hash ? { hash: skill.hash } : {}), name: skill.name, tier, probability, tokens: tier === "pinned" || tier === "armed" ? skill.cost.bodyTokens : tier === "listed" ? skill.cost.listingTokens : 0, reason: reason ?? (forced(skill) ? "Repository configured guidance." : `Averaged probability ${probability.toFixed(4)} meets ${tier} rules.`) });
  }
  plan.skills.sort((a, b) => a.name.localeCompare(b.name));
  return plan;
}

export async function decideSkills(input: SkillsInput, client: Pick<JevClient, "evaluate">, audit: DecisionAuditLog): Promise<AppliedDecision & { plan: SkillPlan }> {
  if (!Number.isSafeInteger(input.budget ?? DEFAULT_SKILL_BUDGET) || (input.budget ?? DEFAULT_SKILL_BUDGET) < 0) throw new Error("Invalid skill budget");
  const learning = Object.fromEntries(Object.entries(input.learning ?? {}).filter(([, value]) => value.samples >= MIN_SKILL_SAMPLES));
  input = { ...input, learning };
  const names = new Set(input.catalogue.skills.map(skill => skill.name));
  if (names.size !== input.catalogue.skills.length || names.has(NONE)) throw new Error("Duplicate or reserved skill name");
  for (const name of [...input.always ?? [], ...input.pins ?? [], ...input.never ?? []]) if (!names.has(name)) throw new Error(`Unknown repository skill: ${name}`);
  const candidates = input.catalogue.skills.filter(skill => !filteredReason(skill, input)).sort((a, b) => {
    const relevance = (skill: SkillCandidate) => [...skill.triggers, skill.name.replaceAll("-", " ")].filter(trigger => input.task.toLowerCase().includes(trigger.toLowerCase())).length;
    const pinned = (skill: SkillCandidate) => input.always?.includes(skill.name) || input.pins?.includes(skill.name);
    return Number(Boolean(pinned(b))) - Number(Boolean(pinned(a))) || relevance(b) - relevance(a) || a.name.localeCompare(b.name);
  }).slice(0, MAX_CANDIDATES);
  // Paths and private descriptions never cross the decision boundary.
  const history = Object.fromEntries(candidates.filter(skill => learning[skill.name]).slice(0, MAX_HISTORY).map(skill => [skill.name, learning[skill.name]!]));
  const state = { ...(Object.keys(history).length ? { history } : {}), task: input.task, stage: input.stage, catalogueHash: input.catalogue.hash, stackTags: [...input.stackTags ?? []].sort() };
  const criteria: Record<string, JevJsonValue> = {};
  for (const skill of candidates) criteria[skill.name] = skill.jevVisible === "names-only" || skill.visibility === "local-only"
    ? { what: "Private guidance (local-only)." }
    : { what: skill.summary, not_for: skill.anti, examples: skill.triggers };
  criteria[NONE] = { what: "No specialised guidance is needed for this task.", not_for: [], examples: [] };
  const revision = digest({ state, criteria, policy: { allowedTools: [...input.allowedTools].sort(), always: input.always ?? [], pins: input.pins ?? [], never: input.never ?? [], budget: input.budget ?? DEFAULT_SKILL_BUDGET, listingBudget: input.listingBudget, bodyBudget: input.bodyBudget }, costs: input.catalogue.skills.map(skill => [skill.name, skill.hash, skill.cost, filteredReason(skill, input)]), ...(Object.keys(learning).length ? { learning } : {}) }).slice(0, 16);
  const baseId = `skills-${input.executionId}-${revision}`;
  let decisionId = baseId;
  for (let retry = 1; ; retry++) {
    const previous = audit.get(decisionId);
    if (!previous?.response.plan) break;
    if (previous.response.plan.source !== "fallback") return { ...audit.replay(decisionId), plan: previous.response.plan };
    decisionId = `${baseId}-retry-${retry}`;
  }
  const candidateNames = [...candidates.map(skill => skill.name), NONE];
  const request: DecisionRequest = { decisionId, executionId: input.executionId, kind: "skills", question: "Which skill best supports the task? Use what, not_for and examples to distinguish neighbouring skills. Select none-needed for routine work that needs no specialised guidance. Judge task fit only.", state, inputs: [{ name: "catalogue-hash", value: input.catalogue.hash }, ...(Object.keys(learning).length ? [{ name: "skill-learning", value: learning }] : [])], candidates: candidateNames, criteria, threshold: 0 };
  const selection: SkillPlan["selection"] = { calls: 0, durationMs: 0, callDurationMs: [], inputTokens: 0, outputTokens: 0, usageReported: true, samples: [] };
  let source: SkillPlan["source"] = "jev";
  let outage: string | undefined;
  let model: string | undefined;
  const started = performance.now();
  try {
    if (candidates.length) {
      const first = ordered(candidateNames, `${revision}-0`);
      let second = ordered(candidateNames, `${revision}-1`);
      if (JSON.stringify(first) === JSON.stringify(second)) second = [...first.slice(1), first[0]!];
      const results = await Promise.allSettled([first, second].map(async (order, index) => {
        const id = `skills-${index}`;
        const questions: Record<string, JevQuestion> = { [id]: { type: "choice", instructions: request.question, criteria: Object.fromEntries(order.map(name => [name, criteria[name] ?? null])) } };
        const callStarted = performance.now();
        selection.calls++;
        try {
          const raw = await client.evaluate(state, questions);
          let response;
          try { response = parseResponse(raw, questions); }
          catch (error) { throw new JevUnavailableError("Invalid skill Choice distribution", { cause: error }); }
          return { order, response, answer: response.answers[id] };
        } finally { selection.callDurationMs[index] = performance.now() - callStarted; }
      }));
      let failure: unknown;
      for (const result of results) {
        if (result.status === "rejected") { failure ??= result.reason; continue; }
        const { order, response, answer } = result.value;
        if (!answer || answer.type !== "choice") throw new JevUnavailableError("Missing skill Choice answer");
        model = response.model;
        selection.samples.push({ order, answer });
        selection.inputTokens += response.usage?.input_tokens ?? 0;
        selection.outputTokens += response.usage?.output_tokens ?? 0;
        selection.usageReported &&= response.usage?.input_tokens !== undefined && response.usage.output_tokens !== undefined;
      }
      if (failure) throw failure;
    }
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    source = "fallback";
    selection.usageReported = false;
    outage = error.message;
  }
  selection.durationMs = performance.now() - started;
  if (!selection.calls) selection.usageReported = false;
  const probabilities = Object.fromEntries(candidateNames.map(name => [name, source === "fallback" ? 0 : selection.samples.length ? selection.samples.reduce((sum, sample) => sum + (sample.answer.probabilities[name] ?? 0), 0) / selection.samples.length : name === NONE ? 1 : 0]));
  const plan = makePlan(input, probabilities, source, selection);
  for (const skill of plan.skills) if (!candidateNames.includes(skill.name) && skill.reason === "Below tier thresholds or unsuitable body/listing cost.") skill.reason = "Prefilter candidate limit reached.";
  const choice = [...candidateNames].sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0) || a.localeCompare(b))[0] ?? NONE;
  const decision: AppliedDecision & { plan: SkillPlan } = {
    decisionId, executionId: input.executionId, kind: "skills", question: request.question, inputs: request.inputs,
    candidates: candidateNames, choice: source === "fallback" ? NONE : choice,
    confidence: probabilities[choice] ?? 0, probabilities, answerType: "choice",
    applied: source === "jev", escalated: source === "fallback",
    reasons: [outage
      ? `Jev unavailable; fallback uses repository always skills only. ${outage}`
      : "Two independently ordered Choice distributions averaged; deterministic tiers and budgets applied."],
    evidenceRefs: [], ...(model ? { model } : {}),
    policyChecks: ["budget", "tools-allowed", "visibility", "catalogue-hash"].map(name => ({
      name, result: "pass", ...(name === "catalogue-hash" ? { reason: input.catalogue.hash } : {}),
    })),
    plan,
  };
  audit.append({ request, response: decision, recordedAt: new Date().toISOString() });
  return decision;
}
