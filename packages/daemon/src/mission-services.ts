import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { decode } from "@toon-format/toon";
import { loadGatewayEnvironment, type KorPaths } from "@kor-code/config";
import { GatewayAdapter, readModelRegistry } from "@kor-code/gateway-adapter";
import { HttpLinearClient, type LinearClient } from "@kor-code/linear";
import { JevClient, resolveJevApiKey } from "@kor-code/jev";
import { redact, runtimeSecrets } from "@kor-code/jev";
import { CalibrationStore, buildReport } from "@kor-code/calibration";
import type { AskRequest, AskResponse, BrainResponse, ConnectRequest, ConnectionsResponse, ModelsResponse, PullsResponse, SuggestedAction } from "@kor-code/mission-control";
import type { JsonValue, Labelled, KorStatusSnapshot, GatewayStrategyObservation } from "@kor-code/core";

const exec = promisify(execFile);
const secret = z.string().min(1).max(8192).regex(/^[^\r\n\0]+$/);
const credentialsSchema = z.strictObject({ linear: secret.optional(), github: secret.optional(), jev: secret.optional(), gateway: z.strictObject({ baseUrl: z.string().url(), apiKey: secret, managementKey: secret.optional() }).optional() });
type Credentials = z.infer<typeof credentialsSchema>;
const pullsSchema = z.array(z.object({ number: z.number().int(), title: z.string(), html_url: z.string().url(), state: z.enum(["open", "closed"]), draft: z.boolean(), merged_at: z.string().nullable(), head: z.object({ sha: z.string() }) }));
export async function atomicPrivateFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => undefined); }
}
export function live<T>(value: T): Labelled<T> { return { value, provenance: "live", observedAt: new Date().toISOString() }; }
export function unavailable<T>(value: T, reason: string): Labelled<T> { return { value, provenance: "unavailable", observedAt: new Date().toISOString(), reason }; }

/** Uses the same adapters, registry and calibration database as the CLI. */
export class MissionServices {
  private credentials: Credentials = {};
  private gatewayAdapter: GatewayAdapter | undefined;
  private gatewaySecrets: string[] = [];
  private probeSequence: Promise<void> = Promise.resolve();
  private connectionWrite: Promise<void> = Promise.resolve();
  constructor(readonly paths: KorPaths, private readonly probe?: (id: string) => Promise<boolean>) {}
  async initialize(): Promise<void> {
    try { this.credentials = credentialsSchema.parse(JSON.parse(await readFile(join(this.paths.stateDir, "connections.json"), "utf8"))); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new Error("Kor connection credentials are unreadable"); }
  }
  secrets(): string[] { return [...this.gatewaySecrets, this.credentials.linear, this.credentials.github, this.credentials.jev, this.credentials.gateway?.apiKey, this.credentials.gateway?.managementKey].filter((value): value is string => value !== undefined); }
  async sessionGateway(): Promise<{ baseUrl: string; key: string | undefined; strategy: GatewayStrategyObservation | null }> {
    const strategy = await (await this.gateway()).routingStrategy();
    const config = this.credentials.gateway;
    if (config) return { baseUrl: config.baseUrl, key: config.apiKey, strategy };
    const environment = await loadGatewayEnvironment(this.paths.gatewayEnvFile);
    this.gatewaySecrets = [environment.key, environment.managementKey].filter((value): value is string => value !== undefined);
    return { ...environment, strategy };
  }
  linear(): LinearClient { return new HttpLinearClient({ ...(this.credentials.linear ? { apiKey: this.credentials.linear } : {}), writes: {} }); }
  async gateway(): Promise<GatewayAdapter> {
    if (this.gatewayAdapter) return this.gatewayAdapter;
    const config = this.credentials.gateway;
    if (config) return this.gatewayAdapter = new GatewayAdapter({ baseUrl: config.baseUrl, apiKey: config.apiKey, ...(config.managementKey ? { managementKey: config.managementKey } : {}) });
    const environment = await loadGatewayEnvironment(this.paths.gatewayEnvFile);
    this.gatewaySecrets = [environment.key, environment.managementKey].filter((value): value is string => value !== undefined);
    return this.gatewayAdapter = new GatewayAdapter({ baseUrl: environment.baseUrl, ...(environment.key ? { apiKey: environment.key } : {}), ...(environment.managementKey ? { managementKey: environment.managementKey } : {}), ...(environment.managementUrl ? { managementUrl: environment.managementUrl } : {}) });
  }
  async connect(input: ConnectRequest): Promise<ConnectionsResponse> {
    const operation = this.connectionWrite.then(() => this.saveConnection(input));
    this.connectionWrite = operation.catch(() => undefined);
    await operation;
    return this.connections();
  }
  private async saveConnection(input: ConnectRequest): Promise<void> {
    let credentials: Credentials;
    switch (input.provider) {
      case "linear": credentials = { ...this.credentials, linear: input.apiKey }; break;
      case "github": credentials = { ...this.credentials, github: input.token }; break;
      case "jev": credentials = { ...this.credentials, jev: input.apiKey }; break;
      case "gateway": credentials = { ...this.credentials, gateway: { baseUrl: input.baseUrl, apiKey: input.apiKey, ...(input.managementKey ? { managementKey: input.managementKey } : {}) } }; break;
      default: { const exhaustive: never = input; throw new Error(String(exhaustive)); }
    }
    const parsed = credentialsSchema.parse(credentials);
    await atomicPrivateFile(join(this.paths.stateDir, "connections.json"), `${JSON.stringify(parsed)}\n`);
    this.credentials = parsed;
    this.gatewayAdapter = undefined;
  }
  private async github(args: string[], cwd?: string): Promise<string> {
    const result = await exec("gh-axi", args, { ...(cwd ? { cwd } : {}), env: { ...process.env, ...(this.credentials.github ? { GH_TOKEN: this.credentials.github } : {}) }, timeout: 20_000, maxBuffer: 2_000_000 });
    return result.stdout;
  }
  shippingEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...environment, ...(this.credentials.github ? { GH_TOKEN: this.credentials.github } : {}), GIT_TERMINAL_PROMPT: "0" };
    const entries: [string, string][] = [];
    if (env.GH_TOKEN || env.GITHUB_TOKEN) entries.push(["credential.https://github.com.helper", ""]);
    entries.push(["credential.https://github.com.helper", "!gh auth git-credential"]);
    const count = Number(env.GIT_CONFIG_COUNT ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid GIT_CONFIG_COUNT");
    for (const [offset, [key, value]] of entries.entries()) {
      env[`GIT_CONFIG_KEY_${count + offset}`] = key;
      env[`GIT_CONFIG_VALUE_${count + offset}`] = value;
    }
    env.GIT_CONFIG_COUNT = String(count + entries.length);
    return env;
  }
  jevApiKey(environment: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
    return resolveJevApiKey(this.credentials.jev, { environment, home: this.paths.home });
  }
  async shippingCommand(file: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const secrets = [...runtimeSecrets(), ...this.secrets()];
    try {
      const result = await exec(file, args, { cwd, timeout: 30_000, maxBuffer: 2_097_152,
        env: this.shippingEnvironment(),
      });
      return { code: 0, stdout: String(redact(result.stdout, secrets)), stderr: String(redact(result.stderr, secrets)) };
    } catch (error) {
      const stdout = error instanceof Error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "Shipping command failed; provider details redacted";
      return { code: error instanceof Error && "code" in error && typeof error.code === "number" ? error.code : -1, stdout: String(redact(stdout, secrets)), stderr: String(redact(stderr, secrets)) };
    }
  }
  jev(): JevClient { return new JevClient(this.credentials.jev ? { apiKey: this.credentials.jev } : {}); }
  async connections(): Promise<ConnectionsResponse> {
    const [linear, github, gateway, jev] = await Promise.allSettled([
      this.linear().listIssues("KOR", 1), this.github(["api", "/user", "--jq", ".login"]), this.gateway().then(adapter => adapter.listModels()), this.jevApiKey(),
    ]);
    return { schemaVersion: 1, connections: [
      { id: "linear", status: linear.status === "fulfilled" ? "connected" : "unavailable", reason: linear.status === "fulfilled" ? null : "Linear credentials or API unavailable" },
      { id: "github", status: github.status === "fulfilled" ? "connected" : "unavailable", reason: github.status === "fulfilled" ? null : "GitHub credentials or API unavailable" },
      { id: "gateway", status: gateway.status === "fulfilled" ? "connected" : "unavailable", reason: gateway.status === "fulfilled" ? null : "Gateway credentials or API unavailable" },
      { id: "jev", status: jev.status === "fulfilled" && jev.value ? "connected" : "unavailable", reason: jev.status === "rejected" ? "Unable to read TypeSafe runtime credential file" : jev.value ? null : "Jev credential not configured; set TYPESAFE_API_KEY or ~/.config/typesafe/env" },
    ] };
  }
  async models(): Promise<ModelsResponse> {
    try {
      const adapter = await this.gateway();
      const catalogue = await adapter.listModels();
      const registry = await readModelRegistry(this.paths.modelsFile);
      return { schemaVersion: 1, models: live((catalogue.data ?? []).map(model => {
        const probe = registry.models.find(item => item.model === model.id);
        return { id: model.id, ...(model.owned_by ? { provider: model.owned_by } : {}), capabilities: probe?.capabilities ?? model.capabilities ?? {}, compatibility: probe?.verified ? "verified" : "unverified" };
      })) };
    } catch { return { schemaVersion: 1, models: unavailable([], "Gateway model catalogue unavailable") }; }
  }
  async quota(): Promise<Labelled<JsonValue | null>> {
    try { const value = await (await this.gateway()).readQuota(); return value === null ? unavailable(null, "Quota measurement unavailable") : live(value); }
    catch { return unavailable(null, "Quota measurement unavailable"); }
  }
  async pulls(repository: { path: string; remote?: string | undefined }): Promise<PullsResponse> {
    try {
      const remote = repository.remote ?? (await exec("git", ["remote", "get-url", "origin"], { cwd: repository.path, timeout: 5_000 })).stdout.trim();
      const slug = /(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
      if (!slug) throw new Error("No GitHub repository");
      const values = pullsSchema.parse(decode(await this.github(["api", `/repos/${slug}/pulls?state=all&per_page=100`, "--jq", "tojson", "--full"], repository.path)));
      return { schemaVersion: 1, bounded: true, pulls: live(values.map(pr => ({ number: pr.number, title: pr.title, url: pr.html_url, state: pr.state, draft: pr.draft, merged: pr.merged_at !== null, head: pr.head.sha }))) };
    } catch { return { schemaVersion: 1, bounded: true, pulls: unavailable([], "GitHub pull requests unavailable") }; }
  }
  brain(snapshot: KorStatusSnapshot): BrainResponse {
    const store = new CalibrationStore(this.paths.databaseFile);
    try {
      return { schemaVersion: 1, decisions: snapshot.decisions ?? unavailable([], "No decision audit available"), calibration: live(buildReport(store)), learnings: unavailable([], "No learned-memory store is configured") };
    } finally { store.close(); }
  }
  async probeModel(id: string): Promise<boolean> {
    const probe = this.probe;
    if (!probe) throw new Error("Model compatibility probe unavailable");
    const operation = this.probeSequence.then(() => probe(id));
    this.probeSequence = operation.then(() => undefined, () => undefined);
    return operation;
  }
  /** Jev selects an explicitly grounded recommendation; the UI invokes it only
   * after the user clicks. Jev's choice API cannot produce free-form prose. */
  async ask(input: AskRequest, snapshot: KorStatusSnapshot): Promise<AskResponse> {
    const actions: SuggestedAction[] = snapshot.runs.filter(run => !input.executionId || run.executionId === input.executionId).flatMap((run): SuggestedAction[] => {
      const label = run.issueKey ?? run.issueId;
      if (run.pullRequestUrl) return [{ kind: "open-pr", url: run.pullRequestUrl, label: `Open ${label}'s pull request` }];
      if (["failed", "blocked", "canceled"].includes(run.status)) return [{ kind: "retry", executionId: run.executionId, label: `Retry ${label} after resolving its blockers` }];
      if (run.status === "waiting") return [{ kind: "approve", executionId: run.executionId, label: `Approve verified ${label} for publication` }];
      return [];
    }).slice(0, 20);
    actions.push({ kind: "navigate", screen: "agents", label: "Inspect the agents and their current blockers" }, { kind: "navigate", screen: "models", label: "Inspect model availability and quota" }, { kind: "navigate", screen: "projects", label: "Choose a Linear issue to queue" });
    const candidates = Object.fromEntries(actions.map((action, index) => [`action-${index}`, action.label]));
    const client = this.jev();
    const result = await client.evaluate({ message: input.message, snapshot }, { recommendation: { type: "choice", instructions: "Choose the recommendation that best answers the user's message using only the supplied live snapshot. Do not claim to execute the action.", criteria: candidates } });
    const answer = result.answers.recommendation;
    if (!answer || answer.type !== "choice") throw new Error("Jev recommendation unavailable");
    const action = actions[Number(answer.choice.slice("action-".length))];
    if (!action) throw new Error("Jev selected an invalid action");
    return { schemaVersion: 1, id: randomUUID(), answer: `Jev recommends: ${action.label}. Confidence: ${Math.round(answer.confidence * 100)}%.`, actions: [action] };
  }
}
