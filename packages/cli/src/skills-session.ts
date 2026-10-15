import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { KorConfig, KorPaths } from "@kor-code/config";
import type { SessionSkillPackRecord } from "@kor-code/core";
import type { SessionLaunch, SessionSkillPack } from "@kor-code/controller";
import { appliedSkillLearning, buildSkillsReport, type CalibrationStore } from "@kor-code/calibration";
import { OVERRIDE_REASON, applySkillOverrides, playbookProblem, type JevDecisionCore } from "@kor-code/jev";
import { buildSkillsCatalogue } from "./skills-catalogue.js";
import { buildSkillsPack, type SkillDeliveryPlan } from "./skills-pack.js";

const packageSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional(), devDependencies: z.record(z.string(), z.string()).optional() });
/** A checkout's npm dependency names, the stack tags skills match against. */
export async function repositoryStackTags(directory: string): Promise<string[]> {
  try {
    const manifest = packageSchema.parse(JSON.parse(await readFile(join(directory, "package.json"), "utf8")));
    return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function validateSessionSkills(config: KorConfig, paths: KorPaths): Promise<void> {
  const catalogue = await buildSkillsCatalogue({ config, paths, estimate: true });
  if (!catalogue.ok) throw new Error("Cannot select session skills from an invalid catalogue; run kor skills doctor");
  const names = new Set(catalogue.skills.map(skill => skill.name));
  for (const [key, repository] of Object.entries(config.repos)) {
    const policy = repository.skills;
    for (const name of [...policy?.always ?? [], ...policy?.pins ?? [], ...policy?.never ?? []]) {
      if (!names.has(name)) throw new Error(`Unknown repository skill in repos.${key}.skills: ${name}; run kor skills doctor`);
    }
  }
}

export async function prepareSessionSkills(options: {
  input: SessionLaunch & { allowedTools: readonly string[] };
  config: KorConfig;
  paths: KorPaths;
  jev: JevDecisionCore;
  calibration?: CalibrationStore;
}): Promise<SessionSkillPack> {
  const { input, config, paths, jev } = options;
  const repository = Object.values(config.repos).find(repository => resolve(repository.path) === resolve(input.repositoryPath));
  const catalogue = await buildSkillsCatalogue({ config, paths, estimate: true });
  if (!catalogue.ok) throw new Error("Cannot select session skills from an invalid catalogue; run kor skills doctor");
  const stackTags = await repositoryStackTags(input.worktreePath);
  const stage = input.skillStage ?? "execute";
  const policy = { stage, allowedTools: input.allowedTools, stackTags, ...repository?.skills,
    ...(config.skills ? { bodyBudget: config.skills.bodyBudget } : {}) };
  const playbookOverride = input.playbookOverride === undefined || input.playbookOverride === "none" ? input.playbookOverride
    : catalogue.skills.find(skill => skill.name === input.playbookOverride && !playbookProblem(skill, policy))?.name;
  const learning = options.calibration ? appliedSkillLearning(buildSkillsReport(options.calibration, { excludeExecutionId: input.execution.id }), catalogue.skills) : {};
  const [decision, playbook] = await Promise.all([jev.selectSkills({ executionId: input.execution.id, task: input.prompt,
    stage, catalogue, allowedTools: input.allowedTools, stackTags, learning, ...repository?.skills,
    ...(config.skills ? { listingBudget: config.skills.listingBudget, bodyBudget: config.skills.bodyBudget } : {}),
  }), jev.selectPlaybook({ executionId: input.execution.id, task: input.prompt,
    stage, catalogue, allowedTools: input.allowedTools, stackTags,
    ...(repository?.skills?.never ? { never: repository.skills.never } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.playbookFailure ? { failure: input.playbookFailure } : {}),
    ...(playbookOverride !== undefined ? { override: playbookOverride } : {}),
  })]);
  const selected = playbook.playbookPlan.selected;
  const effective = applySkillOverrides(decision.plan, catalogue.skills, input.skillOverrides ?? { skills: new Map(), confirmed: new Set() }, policy);
  const plan: SkillDeliveryPlan = { catalogueHash: catalogue.hash, skills: effective.skills.map(skill => ({ name: skill.name,
    tier: skill.name === selected ? "pinned" : skill.tier })) };
  const pack = await buildSkillsPack({ sessionsDir: paths.sessionsDir, executionId: input.execution.id, catalogue, plan, allowedTools: input.allowedTools });
  const repositoryGuidance = [...repository?.skills?.always ?? [], ...repository?.skills?.pins ?? []];
  const record: SessionSkillPackRecord = { catalogueHash: catalogue.hash, tokens: effective.tokens,
    skills: effective.skills.flatMap(skill => skill.tier === "hidden" || skill.name === selected ? [] : [{ name: skill.name, tier: skill.tier, tokens: skill.tokens,
      source: skill.reason === OVERRIDE_REASON ? "override" as const : repositoryGuidance.includes(skill.name) ? "repository" as const : "jev" as const }]),
    playbook: selected ? { name: selected, tokens: catalogue.skills.find(skill => skill.name === selected)?.cost.bodyTokens ?? 0 } : null };
  return { ...pack, decisionId: decision.decisionId, record };
}
