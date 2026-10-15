import { execFile as execFileCallback } from "node:child_process";
import { createServer, request } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { once } from "node:events";
import { z } from "zod";
import { CalibrationStore, buildReport, formatReport, metricFromSession, runSchema } from "../packages/calibration/src/index.js";
import { loadGatewayEnvironment } from "../packages/config/src/index.js";
import { SessionLauncher } from "../packages/controller/src/launcher.js";

const execFile = promisify(execFileCallback);
const sourceRoot = resolve(import.meta.dirname, "..");
const options = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = options.indexOf(name);
  const value = options[index + 1];
  if (index < 0) return undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}
const routeFile = option("--routes");
const revision = option("--revision");
if (!routeFile || !revision) throw new Error("Usage: pnpm context:bench --revision COMMIT --routes FILE [--output DIR] [--case ID] [--repeats N] [--launch-profile lean|standard]");
const launchProfile = z.enum(["lean", "standard"]).parse(option("--launch-profile") ?? "lean");
const repeats = Number(option("--repeats") ?? 3);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("--repeats must be a positive integer");
const cases = [
  { id: "contributor-note", title: "Add a contributor note", task: "Add docs/CONTRIBUTING.md with fewer than 20 lines explaining pnpm build and pnpm typecheck.", checks: ["test -f docs/CONTRIBUTING.md", "grep -q 'pnpm build' docs/CONTRIBUTING.md", "grep -q 'pnpm typecheck' docs/CONTRIBUTING.md", "test $(wc -l < docs/CONTRIBUTING.md) -lt 20"] },
  { id: "docs-index", title: "Add a documentation index", task: "Add docs/INDEX.md linking every Markdown document at the top level of docs/ with a short description.", checks: ["test -f docs/INDEX.md", "grep -q 'architecture.md' docs/INDEX.md", "grep -q 'user-guide.md' docs/INDEX.md", "grep -q 'cli-contract.md' docs/INDEX.md"] },
  { id: "event-refactor", title: "Refactor stream line parsing", task: "Refactor EventCollector.line in packages/controller/src/events.ts into readable multiline code, preserving all behavior and the public interface.", checks: ["git diff --exit-code -- packages/core", "git diff --numstat -- packages/controller/src/events.ts | grep -q .", `node --input-type=module -e 'import { EventCollector } from "./packages/controller/src/events.ts"; const c = new EventCollector(); c.line("stdout", "  "); c.line("stdout", JSON.stringify({type:"result"})); c.line("stderr", "plain"); if(c.events.length !== 2 || c.events[0].kind !== "json" || c.events[0].value.type !== "result" || c.events[1].text !== "plain") process.exit(1);'`] },
  { id: "keyboard-focus", title: "Make keyboard focus visible", task: "Add a :focus-visible outline for buttons in packages/web/src/global.css using the existing palette. Do not change React components.", checks: ["grep -q ':focus-visible' packages/web/src/global.css", "git diff --numstat -- packages/web/src/global.css | grep -q ."] },
  { id: "finite-compact", title: "Handle nonfinite compact counts", task: "Fix compact in packages/web/src/lib/format.ts to display the same unavailable marker as usd when given NaN or Infinity. Keep finite numbers and null behavior unchanged. Do not add tests.", checks: ["git diff --numstat -- packages/web/src/lib/format.ts | grep -q .", `node --input-type=module -e 'import { compact, usd } from "./packages/web/src/lib/format.ts"; if([NaN,Infinity,-Infinity,null,undefined].some(value => compact(value) !== usd(value)) || compact(1000) !== new Intl.NumberFormat("en-GB", {notation:"compact",maximumFractionDigits:1}).format(1000)) process.exit(1);'`] },
];
const selected = option("--case") ? cases.filter(item => item.id === option("--case")) : cases;
if (!selected.length) throw new Error("Unknown --case");
const routeSchema = runSchema.shape.route.extend({ label: z.literal("jev"), decisionId: z.string().min(1) })
  .transform(({ reasoningLevel, ...route }) => ({ ...route, ...(reasoningLevel ? { reasoningLevel } : {}) }));
const routes = z.record(z.string(), routeSchema).parse(JSON.parse(await readFile(resolve(routeFile), "utf8")));
for (const issue of selected) if (!routes[issue.id]) throw new Error(`Missing Jev route for ${issue.id}`);
const output = option("--output") ? resolve(option("--output")!) : await mkdtemp(join(tmpdir(), "kor-context-bench-"));
const fromSource = relative(sourceRoot, output);
if (!fromSource.startsWith("..") && !isAbsolute(fromSource)) throw new Error("--output must be outside the checkout");
await mkdir(output, { recursive: true, mode: 0o700 });
const runRoot = await mkdtemp(join(output, "run-"));
const baseRevision = (await execFile("git", ["rev-parse", `${revision}^{commit}`], { cwd: sourceRoot })).stdout.trim();
const gateway = await loadGatewayEnvironment();
const key = gateway.key;
if (!key) throw new Error("Gateway runtime credential missing");
const upstream = new URL(gateway.baseUrl);
if (upstream.username || upstream.password) throw new Error("Gateway URL must not include credentials");
const store = new CalibrationStore(join(runRoot, "metrics.sqlite"));
let failures = 0;
try {
  for (const issue of selected) for (let repeat = 1; repeat <= repeats; repeat++) {
    const route = routes[issue.id]!;
    const id = `${issue.id}-${repeat}`;
    const directory = join(runRoot, id);
    await mkdir(directory, { mode: 0o700 });
    const repository = join(directory, "repository");
    await execFile("git", ["clone", "--quiet", "--no-hardlinks", sourceRoot, repository]);
    await execFile("git", ["checkout", "--quiet", "--detach", baseRevision], { cwd: repository });
    const captures: { body: Buffer; beta?: string; version?: string }[] = [];
    const pending = new Set<Promise<void>>();
    const proxy = createServer((incoming, outgoing) => {
      const forwarding = (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        if (incoming.method === "POST" && /^\/v1\/messages(?:\?|$)/.test(incoming.url ?? "")) {
          const beta = incoming.headers["anthropic-beta"];
          const version = incoming.headers["anthropic-version"];
          captures.push({ body, ...(typeof beta === "string" ? { beta } : {}), ...(typeof version === "string" ? { version } : {}) });
          await writeFile(join(directory, `request-${captures.length}.json`), body, { mode: 0o600 });
        }
        const headers = { ...incoming.headers, host: upstream.host };
        const send = upstream.protocol === "https:" ? httpsRequest : request;
        await new Promise<void>((resolveForward, reject) => {
          const remote = send(new URL(incoming.url ?? "/", upstream), { method: incoming.method, headers }, response => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
            response.on("end", resolveForward);
            response.on("error", reject);
          });
          remote.on("error", reject);
          outgoing.on("close", () => { remote.destroy(); resolveForward(); });
          remote.setTimeout(300_000, () => remote.destroy(new Error("Gateway request timed out")));
          remote.end(body);
        });
      })().catch(() => { outgoing.destroy(); });
      pending.add(forwarding);
      void forwarding.finally(() => pending.delete(forwarding));
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Capture proxy has no port");
    const startedAt = new Date().toISOString();
    store.beginRun({ executionId: id, pairId: id, issueId: issue.id, arm: "baseline", baseRevision, route, sampled: false, startedAt, status: "running" });
    try {
      const launcher = new SessionLauncher({ repoRoot: sourceRoot, launchProfile, sandboxRoot: join(directory, "sandbox"), gatewayKey: key, env: { KOR_GATEWAY_URL: `http://127.0.0.1:${address.port}` } });
      const session = await launcher.launch({ execution: { id, issueId: issue.id, repository: "bench", worktree: repository, branch: "", status: "running" }, repositoryPath: repository, worktreePath: repository, route,
        allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash(git status*)", "Bash(git diff*)"],
        prompt: `Issue ${issue.id}: ${issue.title}\n\n${issue.task}\n\nDo not add tests, commit, publish, or access anything outside this scratch repository. Kor runs acceptance checks after the session.`, signal: AbortSignal.timeout(300_000) });
      await writeFile(join(directory, "stream.jsonl"), session.stdout, { mode: 0o600 });
      await writeFile(join(directory, "stderr.log"), session.stderr, { mode: 0o600 });
      const checks = await Promise.all(["git diff --check", ...issue.checks].map(async command => {
        try { await execFile("bash", ["-c", command], { cwd: repository, timeout: 30_000 }); return { command, passed: true }; }
        catch { return { command, passed: false }; }
      }));
      const verified = !session.failed && checks.every(check => check.passed);
      const metric = metricFromSession({ executionId: id, attempt: 1, route, startedAt, finishedAt: new Date().toISOString(), session, verified });
      store.recordAttempt(metric);
      store.finishRun(id, verified ? "verified" : "failed");
      const counts = [];
      for (const [index, capture] of captures.entries()) {
        const body = z.object({ model: z.string(), messages: z.array(z.unknown()), system: z.unknown().optional(), tools: z.unknown().optional() }).parse(JSON.parse(capture.body.toString()));
        try {
          const response = await fetch(new URL("/v1/messages/count_tokens", upstream), { method: "POST", signal: AbortSignal.timeout(30_000), redirect: "error",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "anthropic-version": capture.version ?? "2023-06-01", ...(capture.beta ? { "anthropic-beta": capture.beta } : {}) }, body: JSON.stringify(body) });
          counts.push(response.ok ? { request: index + 1, ...z.object({ input_tokens: z.number().int().nonnegative() }).parse(await response.json()) } : { request: index + 1, error: `HTTP ${response.status}` });
        } catch {
          counts.push({ request: index + 1, error: "Count unavailable" });
        }
      }
      const cacheRead = metric.turns?.reduce((sum, turn) => sum + turn.cacheReadTokens, 0) ?? 0;
      const cacheCreation = metric.turns?.reduce((sum, turn) => sum + turn.cacheCreationTokens, 0) ?? 0;
      const cacheReadShare = cacheRead + cacheCreation > 0 ? cacheRead / (cacheRead + cacheCreation) : null;
      const summary = { id, profile: launchProfile, cacheReadShare, baseRevision, route, startContextTokens: metric.startContextTokens, contextTokenSum: metric.contextTokenSum, turns: metric.turns, loadEvents: metric.loadEvents, costUsd: metric.costUsd, verified, checks, countTokens: counts };
      await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      if (!verified) failures++;
    } catch (error) {
      store.finishRun(id, "interrupted");
      const summary = { id, profile: launchProfile, baseRevision, route, error: error instanceof Error ? error.name : "UnknownError", verified: false };
      await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      failures++;
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => proxy.close(error => error ? reject(error) : resolveClose()));
      await Promise.all(pending);
    }
  }
  const report = buildReport(store);
  await writeFile(join(runRoot, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  process.stdout.write(`${formatReport(report, { context: true })}\nArtifacts: ${runRoot}\n`);
} finally { store.close(); }
process.exitCode = failures ? 1 : 0;
