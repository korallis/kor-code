import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { KorConfig, KorPaths } from "@kor-code/config";
import type { SessionLaunch, SessionSkillPack } from "@kor-code/controller";
import { buildSkillsReport, type CalibrationStore } from "@kor-code/calibration";
import { MIN_SKILL_SAMPLES, applySkillOverrides, playbookProblem, type SkillLearning, type JevDecisionCore } from "@kor-code/jev";
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
  const policy = { stage, allowedTools: input.allowedTools, stackTags, ...(repository?.skills?.never ? { never: repository.skills.never } : {}),
    ...(config.skills ? { bodyBudget: config.skills.bodyBudget } : {}) };
  const playbookOverride = input.playbookOverride === undefined || input.playbookOverride === "none" ? input.playbookOverride
    : catalogue.skills.find(skill => skill.name === input.playbookOverride && !playbookProblem(skill, policy))?.name;
  const learning: Record<string, SkillLearning> = {};
  if (options.calibration) {
    const report = buildSkillsReport(options.calibration, { excludeExecutionId: input.execution.id });
    for (const stats of report.skills) {
      if (stats.samples < MIN_SKILL_SAMPLES || !catalogue.skills.some(skill => skill.name === stats.name && skill.hash === stats.hash)) continue;
      learning[stats.name] = { samples: stats.samples, offered: stats.offered, loaded: stats.loaded, used: stats.used,
        passRate: stats.passRate, lift: stats.pairs >= MIN_SKILL_SAMPLES ? stats.lift : null, demoted: stats.demoted, thresholds: stats.thresholds };
    }
  }
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
  const skills = applySkillOverrides(decision.plan, catalogue.skills, input.skillOverrides ?? new Map(), policy).skills;
  const plan: SkillDeliveryPlan = { catalogueHash: catalogue.hash, skills: skills.map(skill => ({ name: skill.name,
    tier: skill.name === selected ? "pinned" : skill.tier })) };
  const pack = await buildSkillsPack({ sessionsDir: paths.sessionsDir, executionId: input.execution.id, catalogue, plan, allowedTools: input.allowedTools });
  return { ...pack, decisionId: decision.decisionId };
}
