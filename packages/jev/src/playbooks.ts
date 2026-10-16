import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { JevUnavailableError, type JevClient } from "./client.js";
import { parseResponse, type JevJsonValue } from "./contracts.js";
import type { AppliedDecision, DecisionAuditLog, DecisionRequest } from "./index.js";
import type { SkillCandidate, SkillsInput } from "./skills.js";

const NONE = "none";
const MAX_CANDIDATES = 254;
export const PLAYBOOK_BODY_BUDGET = 1_500;

export interface PlaybookInput extends Pick<SkillsInput, "executionId" | "task" | "stage" | "catalogue" | "allowedTools" | "stackTags" | "never" | "tracker"> {
  attemptId?: string;
  failure?: { classes: string[]; blockers: string[] };
  override?: string;
}
export const playbookPlanSchema = z.object({
  catalogueHash: z.string(), source: z.enum(["jev", "fallback", "override"]),
  selected: z.string().nullable(), tier: z.enum(["pinned", "hidden"]),
  tokens: z.number().int().nonnegative().max(PLAYBOOK_BODY_BUDGET),
  durationMs: z.number().nonnegative(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).nullable(),
});
export type PlaybookPlan = z.infer<typeof playbookPlanSchema>;

/** Why a catalogue entry cannot be this session's playbook, or undefined when it can. */
export function playbookProblem(skill: SkillCandidate, input: Pick<PlaybookInput, "stage" | "allowedTools" | "stackTags" | "never" | "tracker">): string | undefined {
  if (skill.kind !== "playbook") return "Not a playbook.";
  if (skill.trackers?.length && !skill.trackers.includes(input.tracker ?? "linear")) return "Project tracker does not match.";
  if (input.never?.includes(skill.name)) return "Denied by repository policy.";
  if (skill.stages.length && !skill.stages.includes(input.stage)
    && !(input.stage === "execute" && skill.stages.some(stage => stage === "plan" || stage === "project-setup"))) return "Not available at this stage.";
  const tools = new Set(input.allowedTools.map(tool => tool.split("(")[0]));
  if (skill.requires.some(tool => !tools.has(tool))) return "Requires unavailable tools.";
  if (skill.stackTags?.length && !skill.stackTags.some(tag => input.stackTags?.includes(tag))) return "Repository stack does not match.";
  if (skill.cost.bodyTokens > PLAYBOOK_BODY_BUDGET) return `Body exceeds ${PLAYBOOK_BODY_BUDGET} tokens.`;
  return undefined;
}

export async function decidePlaybook(input: PlaybookInput, client: Pick<JevClient, "evaluate">, audit: DecisionAuditLog): Promise<AppliedDecision & { playbookPlan: PlaybookPlan }> {
  const eligible = input.catalogue.skills.filter(skill => !playbookProblem(skill, input));
  if (new Set(eligible.map(skill => skill.name)).size !== eligible.length || eligible.some(skill => skill.name === NONE)) throw new Error("Duplicate or reserved playbook name");
  if (input.override !== undefined && input.override !== NONE && !eligible.some(skill => skill.name === input.override)) throw new Error("Playbook override is unavailable under current policy");
  const relevance = (skill: typeof eligible[number]) => [...skill.triggers, skill.name.replaceAll("-", " ")]
    .filter(trigger => input.task.toLowerCase().includes(trigger.toLowerCase())).length;
  const candidates = eligible.sort((a, b) => Number(b.name === input.override) - Number(a.name === input.override) || relevance(b) - relevance(a) || a.name.localeCompare(b.name));
  if (candidates.length > MAX_CANDIDATES) throw new Error("Playbook selection supports at most 254 eligible procedures; narrow the catalogue");
  const criteria: Record<string, JevJsonValue> = {};
  for (const skill of candidates) criteria[skill.name] = skill.jevVisible === "names-only" || skill.visibility === "local-only"
      ? { what: "Private guidance (local-only)." }
      : { what: skill.summary, not_for: skill.anti, examples: skill.triggers };
  criteria[NONE] = { what: "No session procedure is needed for this task." };
  const state = { task: input.task, stage: input.stage, tracker: input.tracker ?? "linear", catalogueHash: input.catalogue.hash,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}), ...(input.failure ? { failure: input.failure } : {}) };
  const revision = createHash("sha256").update(JSON.stringify({ state, criteria, costs: candidates.map(skill => [skill.name, skill.cost.bodyTokens]), override: input.override })).digest("hex").slice(0, 16);
  const baseId = `playbook-${input.executionId}-${revision}`;
  let decisionId = baseId;
  for (let retry = 1; ; retry++) {
    const previous = audit.get(decisionId);
    if (!previous?.response.playbookPlan) break;
    if (previous.response.playbookPlan.source !== "fallback") return { ...audit.replay(decisionId), playbookPlan: previous.response.playbookPlan };
    decisionId = `${baseId}-retry-${retry}`;
  }
  const request: DecisionRequest = { decisionId, executionId: input.executionId, kind: "playbook",
    question: "Which single playbook best supports the current task and phase? Use what, not_for and examples to distinguish neighbours. At repair, prioritise the current verification failure over the original task shape. For unresolved accuracy, speed or competing technical approaches, prefer research, independent challenge and an evidence-based decision before implementation. For a failing check with no unresolved approach choice, prefer a procedure that finds and fixes its cause; for diagnosis-only work, prefer investigation. Choose none for routine work needing no procedure. Judge task fit only.",
    state, inputs: [{ name: "catalogue-hash", value: input.catalogue.hash }], candidates: Object.keys(criteria), criteria, threshold: 0,
    ...(input.override !== undefined ? { overrides: { choice: input.override } } : {}) };
  let source: PlaybookPlan["source"] = "jev";
  let choice = NONE;
  let probabilities: Record<string, number> = { [NONE]: 1 };
  let model: string | undefined;
  let usage: PlaybookPlan["usage"] = null;
  let outage: string | undefined;
  const started = performance.now();
  try {
    if (candidates.length && input.override === undefined) {
      const questions = { playbook: { type: "choice" as const, instructions: request.question, criteria } };
      const raw = await client.evaluate(state, questions);
      let response;
      try { response = parseResponse(raw, questions); }
      catch (error) { throw new JevUnavailableError("Invalid playbook Choice distribution", { cause: error }); }
      const answer = response.answers.playbook;
      if (!answer || answer.type !== "choice") throw new JevUnavailableError("Missing playbook Choice answer");
      choice = answer.choice;
      probabilities = answer.probabilities;
      model = response.model;
      if (response.usage?.input_tokens !== undefined && response.usage.output_tokens !== undefined) usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    }
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    source = "fallback";
    outage = error.message;
  }
  if (input.override !== undefined) { choice = input.override; source = "override"; }
  const selected = candidates.find(skill => skill.name === choice);
  const playbookPlan: PlaybookPlan = { catalogueHash: input.catalogue.hash, source, selected: selected?.name ?? null,
    tier: selected ? "pinned" : "hidden", tokens: selected?.cost.bodyTokens ?? 0, durationMs: performance.now() - started, usage };
  const decision: AppliedDecision & { playbookPlan: PlaybookPlan } = {
    decisionId, executionId: input.executionId, kind: "playbook", question: request.question,
    inputs: request.inputs, candidates: request.candidates,
    ...(request.overrides !== undefined ? { overrides: request.overrides } : {}),
    choice, confidence: source === "fallback" ? 0 : probabilities[choice] ?? 0, probabilities, answerType: "choice",
    applied: source !== "fallback", escalated: source === "fallback", playbookPlan,
    reasons: [source === "override" ? "Validated playbook override applied." : outage ? `Jev unavailable; no playbook loaded. ${outage}` : "Single Choice; selected procedure pinned within the playbook budget."],
    evidenceRefs: [], ...(model ? { model } : {}),
    policyChecks: ["single-playbook", "budget", "tools-allowed", "visibility", "catalogue-hash"].map(name => ({ name, result: "pass" })),
  };
  audit.append({ request, response: decision, recordedAt: new Date().toISOString() });
  return decision;
}
