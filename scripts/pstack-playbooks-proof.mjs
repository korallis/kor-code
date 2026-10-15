#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntimeEnvFile } from "../packages/config/dist/index.js";
import { SessionLauncher } from "../packages/controller/dist/index.js";
import { JevClient } from "../packages/jev/dist/index.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const [routesFile, outputDirectory] = process.argv.slice(2);
if (!routesFile || !outputDirectory) throw new Error("Usage: node scripts/pstack-playbooks-proof.mjs ROUTES_JSON OUTPUT_DIRECTORY [SKILL...]");
const output = resolve(outputDirectory);
const fromRepo = relative(repo, output);
if (!fromRepo.startsWith("..") && !isAbsolute(fromRepo)) throw new Error("Keep proof output outside the checkout");
const fixtures = JSON.parse(await readFile(join(repo, "docs/skills-evaluations/pstack.json"), "utf8"));
const names = process.argv.slice(4);
const evaluations = fixtures.evaluations.filter(item => !names.length || names.includes(item.skill));
if (!evaluations.length || names.some(name => !evaluations.some(item => item.skill === name))) throw new Error("Unknown evaluation skill");
const routes = JSON.parse(await readFile(resolve(routesFile), "utf8"));
const lock = JSON.parse(await readFile(join(repo, "skills/pstack.lock.json"), "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");
for (const entry of lock.adaptations) {
  const skill = join(repo, "skills", entry.name);
  if (sha256(await readFile(join(skill, "SKILL.md"))) !== entry.installedSha256) throw new Error(`Adaptation changed: ${entry.name}`);
  if (sha256(await readFile(join(skill, "LICENSE.upstream"))) !== lock.licenseSha256) throw new Error(`License changed: ${entry.name}`);
}
for (const evaluation of evaluations) {
  const route = routes[evaluation.skill];
  if (!route || route.label !== "jev" || !route.decisionId || !route.model || !route.provider) throw new Error(`Supply a recorded Jev route for ${evaluation.skill}`);
  if (evaluation.cases.length !== 3) throw new Error(`Three cases required: ${evaluation.skill}`);
}
const runtime = await readRuntimeEnvFile(join(process.env.HOME, ".config/kor/gateway.env"), { private: true });
const key = runtime.KOR_GATEWAY_KEY || runtime.CPA_API_KEY;
if (!key) throw new Error("Gateway runtime credential missing");
const baseUrl = runtime.KOR_GATEWAY_URL || runtime.CPA_BASE_URL || "http://127.0.0.1:8317";
await mkdir(output, { recursive: true, mode: 0o700 });
const judge = new JevClient();
const results = [];
const EVALUATION_CONCURRENCY = 4;
async function evaluate(evaluation, index) {
  const directory = join(output, evaluation.skill);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sessions = {};
  const body = (await readFile(join(repo, "skills", evaluation.skill, "SKILL.md"), "utf8")).replace(/^---\n[\s\S]*?\n---\n/, "");
  const common = `Review the following three independent engineering situations. Give a concrete recommendation for each, using only the supplied facts. No tools, implementation, publication, or external actions are requested. Return exactly JSON: {"answers":["case 1 recommendation","case 2 recommendation","case 3 recommendation"]}. Keep each answer under 110 words.\n\n${evaluation.cases.map((item, i) => `${i + 1}. ${item.task}`).join("\n\n")}`;
  const order = index % 2 ? ["offered", "baseline"] : ["baseline", "offered"];
  for (const arm of order) {
    const id = `${evaluation.skill}-${arm}`;
    const scratch = join(directory, arm);
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    execFileSync("git", ["init", "-q", scratch]);
    const launcher = new SessionLauncher({ repoRoot: repo, sandboxRoot: join(directory, "sandbox"), gatewayKey: key, env: { KOR_GATEWAY_URL: baseUrl } });
    const session = await launcher.launch({
      execution: { id, issueId: evaluation.skill, repository: "pstack-proof", worktree: scratch, branch: "", status: "running" },
      repositoryPath: scratch, worktreePath: scratch, route: routes[evaluation.skill], allowedTools: [], tools: [],
      prompt: arm === "offered" ? `Selected guidance:\n${body}\n\n${common}` : common,
      signal: AbortSignal.timeout(180_000),
    });
    await writeFile(join(directory, `${arm}.json`), JSON.stringify(session, null, 2), { mode: 0o600 });
    let answers;
    try { answers = JSON.parse(session.telemetry.result.replace(/^```(?:json)?\s*|\s*```$/g, "")).answers; } catch { answers = []; }
    sessions[arm] = { answers, valid: !session.failed && !session.telemetry?.isError && session.telemetry?.permissionDenials === 0 && Array.isArray(answers) && answers.length === 3,
      denials: session.telemetry?.permissionDenials ?? 0, durationMs: session.telemetry?.durationMs ?? null,
      contextTokens: session.telemetry?.startContextTokens ?? null, costUsd: session.telemetry?.totalCostUsd ?? null };
  }
  const questions = {};
  const state = {};
  for (const [i, item] of evaluation.cases.entries()) for (const [armIndex, arm] of order.entries()) {
    const id = `case${i + 1}answer${armIndex + 1}`;
    state[id] = { task: item.task, response: sessions[arm].answers[i] ?? "No usable response", criterion: item.rubric };
    questions[id] = { type: "noul", instructions: `Does state.${id}.response satisfy the criterion for its task? Judge the concrete recommendation, not wording or verbosity. Unexecuted work must not be claimed as executed.`, criteria: { true: "The recommendation addresses the criterion and respects the supplied constraints.", false: "It omits the essential action, contradicts the criterion, or claims unobserved verification." } };
  }
  const verdict = await judge.evaluate(state, questions);
  await writeFile(join(directory, "judgment.json"), JSON.stringify({ state, verdict }, null, 2), { mode: 0o600 });
  const cases = evaluation.cases.map((item, i) => ({ id: item.id, ...Object.fromEntries(order.map((arm, a) => [arm, { pass: sessions[arm].valid && verdict.answers[`case${i + 1}answer${a + 1}`].noul >= 0.5, probability: verdict.answers[`case${i + 1}answer${a + 1}`].noul }])) }));
  const baselinePasses = cases.filter(item => item.baseline.pass).length;
  const offeredPasses = cases.filter(item => item.offered.pass).length;
  const result = { skill: evaluation.skill, cases, baselinePasses, offeredPasses, lift: offeredPasses - baselinePasses, sessions: Object.fromEntries(Object.entries(sessions).map(([arm, { answers, ...counts }]) => [arm, counts])) };
  console.log(`${evaluation.skill}: baseline=${baselinePasses}/3 offered=${offeredPasses}/3 lift=${result.lift}`);
  return result;
}
for (let offset = 0; offset < evaluations.length; offset += EVALUATION_CONCURRENCY) {
  results.push(...await Promise.all(evaluations.slice(offset, offset + EVALUATION_CONCURRENCY).map((evaluation, index) => evaluate(evaluation, offset + index))));
  await writeFile(join(output, "results.json"), JSON.stringify({ schemaVersion: 1, fixtureSha256: sha256(await readFile(join(repo, "docs/skills-evaluations/pstack.json"))), results }, null, 2), { mode: 0o600 });
}
if (results.some(item => item.lift < 0 || item.offeredPasses !== 3 || Object.values(item.sessions).some(session => !session.valid))) process.exitCode = 1;
