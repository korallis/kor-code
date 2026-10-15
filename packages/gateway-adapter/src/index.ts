import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { AccountHealthStatus, GatewayAccountHealth, GatewayCapability, GatewayFacts, GatewayModel, GatewayStrategyObservation, JsonValue, RouteFailureReason, RouteTelemetry } from "@kor-code/core";
import { consumeStream } from "./stream.js";
import { GatewayError, json, publicJson, readJson, record, runtimeConfig, text, type RuntimeConfig } from "./transport.js";
import { readModelRegistry, registryCapabilities } from "./registry.js";
import { modelProvider } from "./models.js";

export * from "./registry.js";
export * from "./models.js";

const execFileAsync = promisify(execFile);
const MANAGEMENT_PATHS = ["/v0/management/auth-files", "/v0/management/config", "/v0/management/usage", "/v0/management/api-key-usage"] as const;
const HEALTH_TTL_MS = 30_000;
const STRATEGY_TIMEOUT_MS = 5_000;

export interface ModelCatalogue { data?: Array<{ id: string; object?: string; owned_by?: string; capabilities?: Partial<Record<GatewayCapability, boolean>> }>; [key: string]: JsonValue | undefined }
export interface GatewayAdapterOptions {
  baseUrl?: string; apiKey?: string; managementKey?: string; managementUrl?: string;
  /** Deprecated: never opened. Usage comes from quota-axi and the management API. */
  usageDbPath?: string;
  fetch?: typeof globalThis.fetch; now?: () => Date; telemetry?: (event: RouteTelemetry) => void;
  modelCapabilities?: Record<string, Partial<Record<GatewayCapability, boolean>>>;
}
export interface CapabilityRequirements { capabilities?: readonly GatewayCapability[] }
export interface RouteRequest extends CapabilityRequirements { prompt?: string; model?: string; provider?: string; sessionId?: string; requestId?: string; decisionId?: string; idempotent?: boolean }
export interface RouteDecision {
  model: string; provider: string;
  /** Preferred slot in the health snapshot, not a verified upstream credential binding. */
  accountSlot?: string | undefined;
  compatibility: GatewayModel["compatibility"]; requiredCapabilities: readonly GatewayCapability[];
}
export interface StreamResult { text: string; route: RouteDecision; telemetry: RouteTelemetry }

function booleanMap(value: unknown): Partial<Record<GatewayCapability, boolean>> {
  if (!record(value)) return {};
  const result: Partial<Record<GatewayCapability, boolean>> = {};
  for (const capability of ["streaming", "tool_calls", "thinking", "structured_output"] as const) {
    if (typeof value[capability] === "boolean") result[capability] = value[capability];
  }
  return result;
}
function headers(apiKey?: string, sessionId?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (apiKey) result.authorization = `Bearer ${apiKey}`;
  if (sessionId) {
    result["x-session-id"] = sessionId;
    result["x-claude-code-session-id"] = sessionId;
    result["x-session-affinity"] = sessionId;
  }
  return result;
}
function modelsFrom(value: JsonValue): ModelCatalogue {
  if (!record(value) || !Array.isArray(value.data)) return {};
  const data = value.data.flatMap((item): NonNullable<ModelCatalogue["data"]> => {
    if (!record(item)) return [];
    const id = text(item.id);
    if (!id) return [];
    const model: NonNullable<ModelCatalogue["data"]>[number] = { id, capabilities: booleanMap(item.capabilities) };
    const object = text(item.object); const owner = text(item.owned_by);
    if (object) model.object = object;
    if (owner) model.owned_by = owner;
    return [model];
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { data };
}
function accountHealthFrom(management: JsonValue | null): GatewayAccountHealth[] {
  if (!record(management)) return [];
  const candidate = management["/v0/management/auth-files"];
  if (!record(candidate) || !Array.isArray(candidate.files)) return [];
  return candidate.files.flatMap((value): GatewayAccountHealth[] => {
    if (!record(value)) return [];
    const identity = text(value.id) ?? text(value.auth_index) ?? text(value.name);
    if (!identity) return [];
    // Stable opaque slots, including when CPA uses account emails as IDs.
    const id = `account-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
    const statusText = (text(value.status) ?? "unknown").toLowerCase();
    const cooldowns = Array.isArray(value.cooldowns) ? value.cooldowns.flatMap((cooldown) => record(cooldown) ? [cooldown] : []) : [];
    const retry = text(value.next_retry_after) ?? cooldowns.map((cooldown) => text(cooldown.retry_at)).find(Boolean);
    const reasons = cooldowns.map((cooldown) => text(cooldown.reason) ?? "").join(" ");
    const quota = record(value.quota) ? value.quota : {};
    const signals = record(quota.signals) ? quota.signals : {};
    const hasQuotaSignal = Object.values(signals).some((signal) => signal === true || typeof signal === "number" && signal <= 0 || typeof signal === "string" && /quota|rate.?limit|exhaust/i.test(signal));
    const exhausted = quota.exceeded === true || signals.exhausted === true || signals.quota_exceeded === true || hasQuotaSignal || /quota|rate.?limit|exhaust/i.test(reasons);
    const authFailure = /auth|credential|unauthori[sz]ed/i.test(reasons);
    const status: AccountHealthStatus = value.disabled === true ? "unavailable"
      : exhausted ? "quota"
      : authFailure ? "authentication"
      : value.unavailable === true || cooldowns.length > 0 || statusText === "error" ? "unavailable"
      : statusText === "active" || statusText === "available" ? "available" : "unknown";
    const provider = text(value.provider) ?? text(value.type);
    return [{ id, status, resetAt: retry, ...(provider ? { provider } : {}) }];
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function eligibleModels(catalogue: ModelCatalogue, requirements: CapabilityRequirements = {}, configured: Record<string, Partial<Record<GatewayCapability, boolean>>> = {}): GatewayModel[] {
  const required = requirements.capabilities ?? [];
  return (catalogue.data ?? []).map((model): GatewayModel => {
    const capabilities = { streaming: true, ...configured[model.id], ...model.capabilities };
    const compatibility = required.some((capability) => capabilities[capability] !== true) ? "incompatible" : "verified";
    return { id: model.id, provider: modelProvider(model.id, model.owned_by), capabilities, compatibility };
  }).filter((model) => model.compatibility === "verified");
}
/** Health-view preference only. CLIProxyAPI owns real account selection. */
export function selectFillFirstAccount(accounts: readonly GatewayAccountHealth[], boundAccount?: string): GatewayAccountHealth | undefined {
  const usable = accounts.filter((account) => account.status === "available").sort((a, b) => a.id.localeCompare(b.id));
  return usable.find((account) => account.id === boundAccount) ?? usable[0];
}

export class GatewayAdapter {
  private readonly options: GatewayAdapterOptions;
  private configPromise: Promise<RuntimeConfig> | undefined;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly affinity = new Map<string, string>();
  private managementCache: { at: number; value: Promise<JsonValue | null> } | undefined;
  private managementAuthFailedAt: number | undefined;
  constructor(options: GatewayAdapterOptions = {}) {
    this.options = options;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }
  private config(): Promise<RuntimeConfig> { return this.configPromise ??= runtimeConfig(this.options); }
  async listModels(): Promise<ModelCatalogue> {
    const { baseUrl, apiKey } = await this.config();
    return modelsFrom(await readJson(await this.fetcher(`${baseUrl}/v1/models`, { headers: headers(apiKey) })));
  }
  async catalogue(requirements: CapabilityRequirements = {}): Promise<GatewayModel[]> {
    const registry = await readModelRegistry();
    const configured = { ...registryCapabilities(registry), ...this.options.modelCapabilities };
    return eligibleModels(await this.listModels(), requirements, configured).filter(model =>
      Object.hasOwn(this.options.modelCapabilities ?? {}, model.id)
      || registry.models.some(item => item.model === model.id && item.verified));
  }
  async accountHealth(): Promise<GatewayAccountHealth[]> { return accountHealthFrom(await this.rawManagement()); }
  async managementAvailable(): Promise<boolean> { return await this.rawManagement() !== null; }
  async routingStrategy(): Promise<GatewayStrategyObservation | null> {
    try {
      const { baseUrl, managementKey, managementUrl } = await this.config();
      if (!managementKey) return null;
      const url = new URL("/v0/management/config", this.options.managementUrl ?? managementUrl ?? baseUrl);
      const response = await this.fetcher(url, { headers: headers(managementKey), redirect: "error", signal: AbortSignal.timeout(STRATEGY_TIMEOUT_MS) });
      const config = await readJson(response);
      const routing = record(config) ? config.routing : undefined;
      const strategy = record(routing) ? routing.strategy : undefined;
      return typeof strategy === "string" && ["fill-first", "round-robin", "weighted-round-robin"].includes(strategy)
        ? { value: strategy, observedAt: this.now().toISOString() } : null;
    } catch { return null; }
  }
  /** Resolve the opaque public slot internally; never expose credential filenames. */
  async setAccountPaused(id: string, paused: boolean): Promise<void> {
    const { baseUrl, managementKey } = await this.config();
    if (!managementKey) throw new Error("Gateway management credential unavailable");
    const response = await this.fetcher(`${baseUrl}/v0/management/auth-files`, { headers: headers(managementKey), redirect: "error", signal: AbortSignal.timeout(15_000) });
    const data = await readJson(response);
    const files = record(data) && Array.isArray(data.files) ? data.files : [];
    const selected = files.find(value => {
      if (!record(value)) return false;
      const identity = text(value.id) ?? text(value.auth_index) ?? text(value.name);
      return identity !== undefined && `account-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}` === id;
    });
    const name = record(selected) ? text(selected.name) : undefined;
    if (!name) throw new Error("Gateway account not found");
    const result = await this.fetcher(`${baseUrl}/v0/management/auth-files/status`, {
      method: "PATCH", headers: { ...headers(managementKey), "content-type": "application/json" },
      body: JSON.stringify({ name, disabled: paused }), redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    await result.body?.cancel();
    if (!result.ok) throw new Error(`Gateway account update failed: HTTP ${result.status}`);
    this.managementCache = undefined;
  }
  async route(request: RouteRequest = {}): Promise<RouteDecision> {
    const required = request.capabilities ?? ["streaming"];
    const models = await this.catalogue({ capabilities: required });
    const model = models.find((candidate) => !request.model || candidate.id === request.model);
    if (!model) throw new Error("Requested model does not satisfy gateway capabilities");
    const accounts = await this.accountHealth();
    const selected = selectFillFirstAccount(accounts, request.sessionId ? this.affinity.get(request.sessionId) : undefined);
    if (request.sessionId && selected) this.affinity.set(request.sessionId, selected.id);
    return { model: model.id, provider: request.provider ?? model.provider ?? modelProvider(model.id), accountSlot: selected?.id, compatibility: model.compatibility, requiredCapabilities: required };
  }
  async streamCompletion(prompt = "Reply with exactly one word: ready", model = process.env.KOR_GATEWAY_MODEL ?? "", options: Omit<RouteRequest, "prompt" | "model"> = {}): Promise<string> {
    const request: RouteRequest = { ...options, prompt };
    if (model) request.model = model;
    return (await this.stream(request)).text;
  }
  async stream(request: RouteRequest = {}): Promise<StreamResult> {
    let route = await this.route(request);
    const id = request.requestId ?? `kor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const maxRetries = request.idempotent === true ? 2 : 0;
    let retryCount = 0;
    let failoverReason: RouteFailureReason | undefined;
    const emit = (streamStarted: boolean, reason = failoverReason): RouteTelemetry => {
      const event: RouteTelemetry = { provider: route.provider, model: route.model, accountSlot: route.accountSlot, accountSlotSource: "health_observation", sessionId: request.sessionId, requestId: id, decisionId: request.decisionId, failoverReason: reason, retryCount, streamStarted, quotaResponse: reason === "quota" || reason === "rate_limit", compatibility: route.compatibility };
      this.options.telemetry?.(event);
      return event;
    };
    while (true) {
      const { baseUrl, apiKey } = await this.config();
      const response = await this.fetcher(`${baseUrl}/v1/chat/completions`, {
        method: "POST", headers: { ...headers(apiKey, request.sessionId), "content-type": "application/json" },
        body: JSON.stringify({ model: route.model, stream: true, messages: [{ role: "user", content: request.prompt ?? "Reply with exactly one word: ready" }] }),
      });
      try {
        if (!response.ok) { await response.body?.cancel(); throw new GatewayError(response.status); }
        const output = await consumeStream(response);
        const telemetry = emit(true);
        return { text: output.replace(/\s+/g, " ").trim(), route, telemetry };
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        emit(error.streamStarted, error.reason);
        if (error.streamStarted || retryCount >= maxRetries || !["quota", "rate_limit", "authentication", "provider_unavailable"].includes(error.reason)) throw error;
        failoverReason = error.reason;
        retryCount += 1;
        if (request.sessionId) this.affinity.delete(request.sessionId);
        // Refresh a successful health snapshot on failover, but retain auth-failure
        // backoff so a misconfigured management key cannot cause a request burst.
        this.managementCache = undefined;
        route = await this.route(request);
      }
    }
  }
  private rawManagement(): Promise<JsonValue | null> {
    const now = this.now().getTime();
    if (this.managementAuthFailedAt !== undefined && now - this.managementAuthFailedAt < 30 * 60_000) return Promise.resolve(null);
    if (this.managementCache && now - this.managementCache.at < HEALTH_TTL_MS) return this.managementCache.value;
    const value = this.fetchManagement();
    this.managementCache = { at: now, value };
    return value;
  }
  private async fetchManagement(): Promise<JsonValue | null> {
    const { baseUrl, managementKey, managementUrl } = await this.config();
    if (!managementKey) return null;
    const customUrl = this.options.managementUrl ?? process.env.CPA_MANAGEMENT_URL ?? managementUrl;
    const paths = customUrl ? [customUrl] : MANAGEMENT_PATHS.map((path) => `${baseUrl}${path}`);
    const entries: Record<string, JsonValue> = {};
    for (const url of paths) {
      try {
        // No client key or session headers on management requests.
        const response = await this.fetcher(url, { headers: headers(managementKey) });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          this.managementAuthFailedAt = this.now().getTime();
          break;
        }
        if (response.status === 404) { await response.body?.cancel(); continue; }
        entries[url.replace(baseUrl, "")] = await readJson(response);
      } catch (error) { if (customUrl) throw error; }
    }
    return Object.keys(entries).length ? entries : null;
  }
  /** Only sanitised management data crosses the public adapter boundary. */
  async readManagement(): Promise<JsonValue | null> { const value = await this.rawManagement(); return value === null ? null : publicJson(value); }
  /** Retained for compatibility. Never open CPA's live WAL database. */
  async readUsageDb(): Promise<null> { return null; }
  async readQuota(): Promise<JsonValue | null> {
    try {
      const result = await execFileAsync("quota-axi", ["--json", "--no-credential-refresh"], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
      return publicJson(json(JSON.parse(result.stdout)));
    } catch { return null; }
  }
  async facts(): Promise<GatewayFacts> {
    const [models, management, usage, quota] = await Promise.all([this.listModels(), this.readManagement(), this.readUsageDb(), this.readQuota()]);
    return { models, management, usage, quota, observedAt: this.now().toISOString() };
  }
}
