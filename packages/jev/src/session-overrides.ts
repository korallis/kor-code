import type { DecisionBundle } from "@kor-code/core";
import { playbookProblem, type PlaybookInput } from "./playbooks.js";
import { MAX_ARMED_BODY_TOKENS, MAX_BODY_TOKENS, SKILL_TOOL_TOKENS, filteredReason, type SkillCandidate, type SkillPlan, type SkillsInput } from "./skills.js";

export type SkillTier = SkillPlan["skills"][number]["tier"];
export const SESSION_TARGETS = ["skills", "playbook", "tools"] as const;
export type SessionTarget = typeof SESSION_TARGETS[number];
/** One operator edit to the next session's pack: a skill tier (`auto` loads it the way a repository pin does), the playbook, or a tool. */
export type SessionEdit =
  | { target: "skills"; name: string; tier: SkillTier | "auto"; overBudget?: boolean }
  | { target: "playbook"; name: string }
  | { target: "tools"; name: string; present: boolean };
/**
 * Edits folded in order; a later edit to the same skill or tool replaces an earlier one.
 * `confirmed` names the skills whose latest edit the operator confirmed above the repository budget.
 */
export interface SessionOverrides { skills: Map<string, SkillTier | "auto">; confirmed: Set<string>; playbook?: string; tools: Map<string, boolean> }
export type SkillOverridePolicy = Pick<SkillsInput, "stage" | "allowedTools" | "stackTags" | "never" | "always" | "pins" | "bodyBudget">;
type PolicyCheck = DecisionBundle["policyChecks"][number];

const NAME = "[a-z0-9][a-z0-9-]{0,63}";
const TOOL = "[A-Za-z][A-Za-z0-9_]{0,127}";
const SKILL_ADD = new RegExp(`^skill:([+-])(${NAME})$`);
const SKILL_TIER = new RegExp(`^skill:(${NAME})=(pinned|listed|armed|hidden)$`);
const PLAYBOOK = new RegExp(`^(?:playbook:)?(${NAME})$`);
const TOOL_EDIT = new RegExp(`^tool:([+-])(${TOOL})$`);
const LABEL = /^kor:(skill|playbook|tool)\/(.+)$/;
const NO_PLAYBOOK = "none";

export function parseSessionEdit(target: string, choice: string): SessionEdit | undefined {
  let match: RegExpExecArray | null;
  if (target === "skills" && (match = SKILL_ADD.exec(choice))) return { target, name: match[2]!, tier: match[1] === "+" ? "auto" : "hidden" };
  if (target === "skills" && (match = SKILL_TIER.exec(choice))) return { target, name: match[1]!, tier: match[2] as SkillTier };
  if (target === "playbook" && (match = PLAYBOOK.exec(choice))) return { target, name: match[1]! };
  if (target === "tools" && (match = TOOL_EDIT.exec(choice))) return { target, name: match[2]!, present: match[1] === "+" };
  return undefined;
}

export function sessionEditChoice(edit: SessionEdit): string {
  switch (edit.target) {
    case "skills": return edit.tier === "auto" ? `skill:+${edit.name}` : edit.tier === "hidden" ? `skill:-${edit.name}` : `skill:${edit.name}=${edit.tier}`;
    case "playbook": return edit.name;
    case "tools": return `tool:${edit.present ? "+" : "-"}${edit.name}`;
  }
}

/** Per-issue edits from Linear labels: `kor:skill/<name>` (also `-<name>`, `<name>=<tier>`), `kor:playbook/<name>`, `kor:tool/<Tool>` (also `-<Tool>`). */
export function labelEdits(labels: readonly string[]): SessionEdit[] {
  return labels.flatMap(label => {
    const [, kind, value = ""] = LABEL.exec(label.trim()) ?? [];
    const edit = kind === "skill" ? parseSessionEdit("skills", `skill:${/^[+-]/.test(value) || value.includes("=") ? value : `+${value}`}`)
      : kind === "playbook" ? parseSessionEdit("playbook", value)
      : kind === "tool" ? parseSessionEdit("tools", `tool:${/^[+-]/.test(value) ? value : `+${value}`}`)
      : undefined;
    return edit ? [edit] : [];
  });
}

export function foldSessionEdits(edits: readonly SessionEdit[]): SessionOverrides {
  const overrides: SessionOverrides = { skills: new Map(), confirmed: new Set(), tools: new Map() };
  for (const edit of edits) {
    if (edit.target === "skills") {
      overrides.skills.set(edit.name, edit.tier);
      if (edit.overBudget) overrides.confirmed.add(edit.name);
      else overrides.confirmed.delete(edit.name);
    }
    else if (edit.target === "tools") overrides.tools.set(edit.name, edit.present);
    else overrides.playbook = edit.name;
  }
  return overrides;
}

const pinnedLimit = (policy: SkillOverridePolicy) => Math.min(policy.bodyBudget ?? MAX_BODY_TOKENS, MAX_BODY_TOKENS);
function resolvedTier(skill: SkillCandidate, tier: SkillTier | "auto", policy: SkillOverridePolicy): SkillTier {
  if (tier !== "auto") return tier;
  return skill.cost.bodyTokens <= pinnedLimit(policy) ? "pinned" : "listed";
}

/** Why `skill` cannot take `tier` in this session, or undefined when it can. The deny list outranks every override. */
export function skillOverrideProblem(skill: SkillCandidate | undefined, tier: SkillTier, policy: SkillOverridePolicy): string | undefined {
  if (!skill) return "Not in the skill catalogue.";
  if (tier === "hidden") return undefined;
  const filtered = filteredReason(skill, policy);
  if (filtered) return filtered;
  if (tier === "pinned" && skill.cost.bodyTokens > pinnedLimit(policy)) return `Body exceeds the ${pinnedLimit(policy)}-token pinned limit.`;
  if (tier === "listed" && skill.cost.listingTokens === 0) return "Has no listing; it is manual-only.";
  if (tier === "armed" && (!skill.triggers.length || skill.cost.bodyTokens > MAX_ARMED_BODY_TOKENS)) return `Arming needs triggers and a body within ${MAX_ARMED_BODY_TOKENS} tokens.`;
  return undefined;
}

export function planTokens(entries: SkillPlan["skills"]): SkillPlan["tokens"] {
  const sum = (tier: SkillTier) => entries.filter(entry => entry.tier === tier).reduce((total, entry) => total + entry.tokens, 0);
  const pinned = sum("pinned");
  const listed = sum("listed");
  const tool = entries.some(entry => entry.tier === "listed") ? SKILL_TOOL_TOKENS : 0;
  return { pinned, listed, tool, total: pinned + listed + tool };
}

/**
 * Jev's plan with operator overrides applied: deny list > override > repository pin > Jev.
 * An edit policy refuses keeps Jev's tier and says why. The merged plan is held to the
 * plan's budget again, because Jev replans every session: Jev's own picks are hidden
 * first, lowest probability first; then the overrides the operator did not confirm over
 * budget, latest first.
 */
export function applySkillOverrides(plan: SkillPlan, skills: readonly SkillCandidate[], overrides: Pick<SessionOverrides, "skills" | "confirmed">, policy: SkillOverridePolicy): SkillPlan {
  if (!overrides.skills.size) return plan;
  const applied = new Set<string>();
  const entries = plan.skills.map(entry => {
    const wanted = overrides.skills.get(entry.name);
    if (wanted === undefined) return entry;
    const skill = skills.find(candidate => candidate.name === entry.name);
    const tier = skill ? resolvedTier(skill, wanted, policy) : "hidden";
    const problem = skillOverrideProblem(skill, tier, policy);
    if (problem) return { ...entry, reason: `Override not applied: ${problem}` };
    applied.add(entry.name);
    const tokens = tier === "pinned" || tier === "armed" ? skill!.cost.bodyTokens : tier === "listed" ? skill!.cost.listingTokens : 0;
    return { ...entry, tier, tokens, reason: "Operator override." };
  });
  const repository = (name: string) => policy.always?.includes(name) || policy.pins?.includes(name);
  const costly = (entry: SkillPlan["skills"][number]) => entry.tier === "pinned" || entry.tier === "listed";
  const jevPicks = entries.filter(entry => costly(entry) && !applied.has(entry.name) && !repository(entry.name))
    .sort((a, b) => a.probability - b.probability || b.tokens - a.tokens);
  const overridden = [...overrides.skills.keys()].reverse().filter(name => !overrides.confirmed.has(name))
    .flatMap(name => entries.filter(entry => entry.name === name && applied.has(name) && costly(entry)));
  const trim = [...jevPicks.map(entry => [entry, "Hidden to keep operator overrides within the skill budget."] as const),
    ...overridden.map(entry => [entry, "Override not applied: over the skill budget without confirmation."] as const)];
  for (const [entry, reason] of trim) {
    if (planTokens(entries).total <= plan.budget) break;
    entries[entries.indexOf(entry)] = { ...entry, tier: "hidden", tokens: 0, reason };
  }
  return { ...plan, skills: entries, tokens: planTokens(entries) };
}

/** A plan with every catalogue skill hidden, for projecting edits before Jev has planned a session. */
export function emptySkillPlan(catalogue: { hash: string; skills: readonly SkillCandidate[] }, budget: number): SkillPlan {
  return { catalogueHash: catalogue.hash, source: "fallback", budget, tokens: { pinned: 0, listed: 0, tool: 0, total: 0 },
    skills: catalogue.skills.map(skill => ({ name: skill.name, tier: "hidden", probability: 0, tokens: 0, reason: "Not planned yet." })),
    selection: { calls: 0, durationMs: 0, callDurationMs: [], inputTokens: 0, outputTokens: 0, usageReported: false, samples: [] } };
}

export interface SessionEditContext {
  skills: readonly SkillCandidate[];
  /** Jev's latest skills plan for the execution, before overrides. */
  plan: SkillPlan;
  /** Overrides already in force. */
  overrides: SessionOverrides;
  policy: SkillOverridePolicy & Pick<PlaybookInput, "stage">;
  /** The playbook Jev or an earlier override selected, if any. */
  playbook: string | null;
  /** Tool names repository policy permits for sessions. */
  eligibleTools: readonly string[];
  /** The operator accepted a plan over the repository's skill budget. */
  overBudget?: boolean;
}
export interface SessionEditReview { checks: PolicyCheck[]; tokens: { before: number; after: number } | null; previous?: string }

const check = (name: string, problem: string | undefined, passReason?: string): PolicyCheck =>
  ({ name, result: problem ? "fail" : "pass", ...(problem ? { reason: problem } : passReason ? { reason: passReason } : {}) });

/** The policy checks an edit must pass and the per-turn token cost of the next session's guidance before and after it. */
export function reviewSessionEdit(edit: SessionEdit, context: SessionEditContext): SessionEditReview {
  const { skills, policy } = context;
  if (edit.target === "skills") {
    const skill = skills.find(candidate => candidate.name === edit.name);
    const before = applySkillOverrides(context.plan, skills, context.overrides, policy);
    const edited = new Map([...context.overrides.skills, [edit.name, edit.tier]]);
    const confirmed = applySkillOverrides(context.plan, skills, { skills: edited, confirmed: new Set([...context.overrides.confirmed, edit.name]) }, policy);
    const tier = skill ? resolvedTier(skill, edit.tier, policy) : "hidden";
    const problem = skillOverrideProblem(skill, tier, policy);
    const overspend = confirmed.tokens.total > context.plan.budget && confirmed.tokens.total > before.tokens.total;
    const current = before.skills.find(entry => entry.name === edit.name)?.tier;
    return {
      checks: [
        check("skill in the catalogue", skill && skill.kind !== "playbook" ? undefined : skill ? "Playbooks are overridden with the playbook target." : "Not in the skill catalogue."),
        check("allowed by repository policy", skill && skill.kind !== "playbook" ? problem : undefined),
        check("within the skill budget", overspend && !context.overBudget ? `${confirmed.tokens.total} tokens exceed the ${context.plan.budget}-token budget; confirm over budget to accept.` : undefined,
          overspend ? "Over budget, confirmed by the operator." : undefined),
        check("not already overridden", context.overrides.skills.get(edit.name) === edit.tier && (context.overrides.confirmed.has(edit.name) || !context.overBudget)
          ? "The same override is already in force." : undefined),
      ],
      tokens: { before: before.tokens.total, after: confirmed.tokens.total },
      ...(current ? { previous: current } : {}),
    };
  }
  if (edit.target === "playbook") {
    const skill = skills.find(candidate => candidate.name === edit.name);
    const current = context.overrides.playbook ?? context.playbook ?? NO_PLAYBOOK;
    const cost = (name: string) => skills.find(candidate => candidate.name === name)?.cost.bodyTokens ?? 0;
    return {
      checks: [
        check("playbook in the catalogue", edit.name === NO_PLAYBOOK || skill?.kind === "playbook" ? undefined : "Not a playbook in the catalogue."),
        check("allowed by repository policy", edit.name === NO_PLAYBOOK || !skill ? undefined : playbookProblem(skill, policy)),
        check("not already overridden", context.overrides.playbook === edit.name ? "The same override is already in force." : undefined),
      ],
      tokens: { before: cost(current), after: cost(edit.name) },
      previous: current,
    };
  }
  return {
    checks: [
      check("allowed by repository policy", context.eligibleTools.includes(edit.name) ? undefined : `${edit.name} is outside the repository's tool policy.`),
      check("not already overridden", context.overrides.tools.get(edit.name) === edit.present ? "The same override is already in force." : undefined),
    ],
    tokens: null,
    ...(context.overrides.tools.has(edit.name) ? { previous: context.overrides.tools.get(edit.name) ? "added" : "removed" } : {}),
  };
}
