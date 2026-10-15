import { mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const nonempty = z.string().trim().min(1);
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const repositorySchema = z.strictObject({
  path: nonempty,
  remote: nonempty.optional(),
  linearTeam: nonempty.optional(),
  linearProject: nonempty.optional(),
  defaultBranch: nonempty.default("main"),
  checks: z.array(nonempty).default([]),
  toolAllowlist: z.array(nonempty).default([]),
  tools: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)).optional(),
  skills: z.strictObject({
    always: z.array(nonempty).default([]),
    pins: z.array(nonempty).default([]),
    never: z.array(nonempty).default([]),
    budget: positiveInteger.default(4_000),
  }).optional(),
  /** Existing repositories retain automatic publication; Mission Control can gate it. */
  ship: z.enum(["approve", "auto"]).default("auto"),
});
export const routeSchema = z.strictObject({
  provider: nonempty.default("anthropic"),
  model: nonempty.default("claude-sonnet-5-5"),
  accountPolicy: z.enum(["fill-first", "manual", "least-used"]).default("fill-first"),
  sessionAffinity: z.boolean().default(true),
  reasoningLevel: z.enum(["low", "medium", "high"]).default("medium"),
});
export const calibrationSchema = z.strictObject({
  sampleRate: z.number().min(0).max(1).default(0.25),
  baselineRoute: routeSchema.prefault({}),
});
export const skillsConfigSchema = z.strictObject({
  privatePath: nonempty.optional(),
  packs: z.array(nonempty).default([]),
  jev: z.enum(["names-only", "full"]).default("names-only"),
  listingBudget: positiveInteger.default(8_000),
  bodyBudget: positiveInteger.default(2_000),
});
export const korConfigSchema = z.strictObject({
  repos: z.record(nonempty, repositorySchema).default({}),
  limits: z.strictObject({
    total: positiveInteger.default(2),
    perRepository: positiveInteger.default(1),
    perProvider: positiveInteger.optional(),
  }).prefault({}),
  defaultRoute: routeSchema.prefault({}),
  launchProfile: z.enum(["lean", "standard"]).default("lean"),
  pollIntervalSeconds: positiveInteger.default(60),
  intakeLabel: nonempty.default("kor"),
  calibration: calibrationSchema.prefault({}),
  skills: skillsConfigSchema.optional(),
});
export type KorRepositoryConfig = z.infer<typeof repositorySchema>;
export type KorLimits = KorConfig["limits"];
export type KorConfig = z.infer<typeof korConfigSchema>;

export function repositoryKeyForIssue(issue: { teamKey: string; projectId?: string }, config: KorConfig): string {
  const entries = Object.entries(config.repos);
  const match = entries.find(([, repository]) => repository.linearProject && repository.linearProject === issue.projectId)
    ?? entries.find(([, repository]) => repository.linearTeam && repository.linearTeam === issue.teamKey)
    ?? entries.find(([key]) => key === issue.projectId || key === issue.teamKey);
  if (!match) throw new Error(`No Kor repository mapping for Linear team ${issue.teamKey}`);
  return match[0];
}

export interface KorPaths {
  home: string;
  configDir: string;
  configFile: string;
  gatewayEnvFile: string;
  stateDir: string;
  shareDir: string;
  databaseFile: string;
  modelsFile: string;
  snapshotsDir: string;
  logsDir: string;
  worktreesDir: string;
  sessionsDir: string;
}
export interface LoadedConfig { config: KorConfig; path: string; exists: boolean }
export interface GatewayEnvironment {
  baseUrl: string;
  key: string | undefined;
  managementKey: string | undefined;
  managementUrl: string | undefined;
}

export function runtimePaths(environment: NodeJS.ProcessEnv = process.env): KorPaths {
  const home = resolve(environment.HOME || homedir());
  const configDir = resolve(environment.XDG_CONFIG_HOME || join(home, ".config"), "kor");
  const stateDir = resolve(environment.XDG_STATE_HOME || join(home, ".local/state"), "kor");
  const shareDir = resolve(environment.XDG_DATA_HOME || join(home, ".local/share"), "kor");
  return {
    home, configDir, stateDir, shareDir,
    configFile: join(configDir, "config.yaml"),
    gatewayEnvFile: join(configDir, "gateway.env"),
    databaseFile: join(stateDir, "kor.db"),
    modelsFile: join(stateDir, "models.json"),
    snapshotsDir: join(stateDir, "snapshots"),
    logsDir: join(stateDir, "logs"),
    worktreesDir: join(shareDir, "worktrees"),
    sessionsDir: join(shareDir, "sessions"),
  };
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function parseKorConfig(input: unknown, options: { home?: string; baseDir?: string } = {}): KorConfig {
  const parsed = korConfigSchema.safeParse(input);
  // No YAML snippets, input values, or upstream error messages in diagnostics.
  if (!parsed.success) throw new Error("Invalid Kor config: expected the documented config schema");
  const home = options.home ?? homedir();
  const baseDir = options.baseDir ?? process.cwd();
  const resolvePath = (path: string) => resolve(baseDir, path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path);
  return {
    ...parsed.data,
    ...(parsed.data.skills ? { skills: {
      ...parsed.data.skills,
      packs: parsed.data.skills.packs.map(resolvePath),
      ...(parsed.data.skills.privatePath ? { privatePath: resolvePath(parsed.data.skills.privatePath) } : {}),
    } } : {}),
    repos: Object.fromEntries(Object.entries(parsed.data.repos).map(([key, repository]) => {
      const path = repository.path === "~" ? home : repository.path.startsWith("~/")
        ? join(home, repository.path.slice(2)) : repository.path;
      return [key, { ...repository, path: isAbsolute(path) ? resolve(path) : resolve(baseDir, path) }];
    })),
  };
}

export async function loadKorConfig(path = runtimePaths().configFile, options: { home?: string } = {}): Promise<LoadedConfig> {
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if (missing(error)) return { config: parseKorConfig({}), path, exists: false };
    throw new Error("Cannot read Kor config");
  }
  let input: unknown;
  try { input = parseYaml(source, { maxAliasCount: 50 }); }
  catch { throw new Error("Invalid Kor config: malformed YAML"); }
  return { config: parseKorConfig(input, { ...options, baseDir: dirname(path) }), path, exists: true };
}

/** Parse assignments without shell evaluation, interpolation, or command substitution. */
export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1] || match[2] === undefined) throw new Error("Invalid runtime env file: expected NAME=value assignments");
    const raw = match[2];
    if (raw.startsWith('"') || raw.startsWith("'")) {
      const quoted = /^(['"])(.*?)\1\s*(?:#.*)?$/.exec(raw);
      if (quoted?.[2] === undefined) throw new Error("Invalid runtime env file: unmatched quote");
      values[match[1]] = quoted[2];
    } else values[match[1]] = raw.replace(/\s+#.*$/, "").trim();
  }
  return values;
}

export async function readRuntimeEnvFile(path: string, options: { private?: boolean } = {}): Promise<Record<string, string>> {
  try {
    if (options.private && process.platform !== "win32" && ((await stat(path)).mode & 0o077) !== 0) {
      throw new Error("Gateway credential file must have mode 0600");
    }
    return parseDotEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (missing(error)) return {};
    if (error instanceof Error && error.message === "Gateway credential file must have mode 0600") throw error;
    throw new Error("Cannot read runtime env file or invalid assignments");
  }
}

export function gatewayUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Invalid gateway URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid gateway URL");
  return value.replace(/\/$/, "");
}

export async function loadGatewayEnvironment(path = runtimePaths().gatewayEnvFile, environment: NodeJS.ProcessEnv = process.env): Promise<GatewayEnvironment> {
  const values = await readRuntimeEnvFile(path, { private: true });
  const paths = runtimePaths(environment);
  const management = await readRuntimeEnvFile(join(paths.home, ".config/cpa-management.env"));
  let key = environment.KOR_GATEWAY_KEY || environment.CPA_API_KEY;
  if (!key && environment.KOR_GATEWAY_KEY_FILE) {
    try {
      // Legacy runtime key files are raw tokens. Also accept a gateway.env assignment.
      const source = (await readFile(environment.KOR_GATEWAY_KEY_FILE, "utf8")).trim();
      key = /^\s*(?:export\s+)?KOR_GATEWAY_KEY\s*=/.test(source) ? parseDotEnv(source).KOR_GATEWAY_KEY : source;
    } catch { throw new Error("Cannot read KOR_GATEWAY_KEY_FILE"); }
  }
  const baseUrl = gatewayUrl(environment.KOR_GATEWAY_URL || environment.CPA_BASE_URL || values.KOR_GATEWAY_URL || values.CPA_BASE_URL || management.CPA_BASE_URL || "http://127.0.0.1:8317");
  const managementUrl = environment.CPA_MANAGEMENT_URL || values.CPA_MANAGEMENT_URL || management.CPA_MANAGEMENT_URL;
  return {
    baseUrl,
    key: key || values.KOR_GATEWAY_KEY || values.CPA_API_KEY || undefined,
    managementKey: environment.CPA_MANAGEMENT_KEY || values.CPA_MANAGEMENT_KEY || management.CPA_MANAGEMENT_KEY || undefined,
    managementUrl: managementUrl ? gatewayUrl(managementUrl) : undefined,
  };
}

/** Explicit initialization for install/serve callers. Reading config and doctor never creates directories. */
export async function ensureRuntimeDirectories(paths = runtimePaths()): Promise<void> {
  for (const directory of [paths.configDir, paths.stateDir, paths.snapshotsDir, paths.logsDir, paths.shareDir, paths.worktreesDir, paths.sessionsDir]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
}
