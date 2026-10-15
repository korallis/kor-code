import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { KorConfig, KorPaths } from "@kor-code/config";
import type { SessionLaunch, SessionSkillPack } from "@kor-code/controller";
import type { JevDecisionCore } from "@kor-code/jev";
import { buildSkillsCatalogue } from "./skills-catalogue.js";
import { buildSkillsPack } from "./skills-pack.js";

const packageSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional(), devDependencies: z.record(z.string(), z.string()).optional() });
export async function prepareSessionSkills(options: {
  input: SessionLaunch & { allowedTools: readonly string[] };
  config: KorConfig;
  paths: KorPaths;
  jev: JevDecisionCore;
}): Promise<SessionSkillPack> {
  const { input, config, paths, jev } = options;
  const repository = Object.values(config.repos).find(repository => resolve(repository.path) === resolve(input.repositoryPath));
  const catalogue = await buildSkillsCatalogue({ config, paths, estimate: true });
  if (!catalogue.ok) throw new Error("Cannot select session skills from an invalid catalogue; run kor skills doctor");
  let stackTags: string[] = [];
  try {
    const manifest = packageSchema.parse(JSON.parse(await readFile(join(input.worktreePath, "package.json"), "utf8")));
    stackTags = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const decision = await jev.selectSkills({ executionId: input.execution.id, task: input.prompt,
    stage: input.skillStage ?? "execute",
    catalogue, allowedTools: input.allowedTools, stackTags, ...repository?.skills,
    ...(config.skills ? { listingBudget: config.skills.listingBudget, bodyBudget: config.skills.bodyBudget } : {}),
  });
  return buildSkillsPack({ sessionsDir: paths.sessionsDir, executionId: input.execution.id, catalogue, plan: decision.plan, allowedTools: input.allowedTools });
}
