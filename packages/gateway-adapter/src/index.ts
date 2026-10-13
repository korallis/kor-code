import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { GatewayFacts, JsonValue } from "@kor-code/core";

const execFileAsync = promisify(execFile);
export interface GatewayAdapterOptions { baseUrl?: string; apiKey?: string; managementKey?: string; managementUrl?: string; usageDbPath?: string; fetch?: typeof globalThis.fetch }
export interface ModelCatalogue { data?: Array<{ id?: string; object?: string; owned_by?: string }>; [key: string]: JsonValue | undefined }

async function resolveGatewayKey(explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  if (process.env.KOR_GATEWAY_KEY) return process.env.KOR_GATEWAY_KEY;
  try {
    const key = (await readFile("/mnt/c/Users/leeba/Tools/CLIProxyAPI/client-api-key.txt", "utf8")).trim();
    return key || undefined;
  } catch { return undefined; }
}

async function resolveManagementKey(explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  if (process.env.CPA_MANAGEMENT_KEY) return process.env.CPA_MANAGEMENT_KEY;
  try {
    const text = await readFile(`${process.env.HOME ?? ""}/.config/cpa-management.env`, "utf8");
    const match = /^\s*(?:export\s+)?CPA_MANAGEMENT_KEY\s*=\s*(.+?)\s*$/m.exec(text);
    return match?.[1]?.replace(/^['"]|['"]$/g, "");
  } catch { return undefined; }
}

function headers(apiKey?: string, managementKey?: string): HeadersInit {
  const result: Record<string, string> = {};
  if (apiKey) result.authorization = `Bearer ${apiKey}`;
  if (managementKey) result["x-management-key"] = managementKey;
  return result;
}

async function readJsonResponse(response: Response): Promise<JsonValue> {
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  try { return JSON.parse(text) as JsonValue; } catch { return { raw: text }; }
}

export class GatewayAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly managementKey: string | undefined;
  private readonly managementUrl: string | undefined;
  private readonly usageDbPath: string | undefined;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: GatewayAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.CPA_BASE_URL ?? "http://127.0.0.1:8317").replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.CPA_API_KEY;
    this.managementKey = options.managementKey ?? process.env.CPA_MANAGEMENT_KEY;
    this.managementUrl = options.managementUrl ?? process.env.CPA_MANAGEMENT_URL;
    this.usageDbPath = options.usageDbPath ?? process.env.CPA_USAGE_DB;
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async listModels(): Promise<ModelCatalogue> {
    const apiKey = await resolveGatewayKey(this.apiKey);
    return await readJsonResponse(await this.fetcher(`${this.baseUrl}/v1/models`, { headers: headers(apiKey, this.managementKey) })) as ModelCatalogue;
  }

  async streamCompletion(prompt = "Reply with exactly one word: ready", model = process.env.KOR_GATEWAY_MODEL ?? ""): Promise<string> {
    if (!model) throw new Error("set KOR_GATEWAY_MODEL or pass a catalogue model to streamCompletion");
    const apiKey = await resolveGatewayKey(this.apiKey);
    const response = await this.fetcher(`${this.baseUrl}/v1/chat/completions`, { method: "POST", headers: { ...headers(apiKey, this.managementKey), "content-type": "application/json" }, body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: prompt }] }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    if (!response.body) throw new Error("Gateway returned no stream body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return "[DONE]";
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
          const text = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
          if (text) return text.replace(/\s+/g, " ").trim();
        } catch { /* Ignore non-JSON SSE comments. */ }
      }
      if (chunk.done) break;
    }
    throw new Error("Gateway stream ended before a completion token");
  }

  async readManagement(): Promise<JsonValue | null> {
    const apiKey = await resolveGatewayKey(this.apiKey);
    const managementKey = await resolveManagementKey(this.managementKey);
    const urls = this.managementUrl ? [this.managementUrl] : [`${this.baseUrl}/v0/management/config`, `${this.baseUrl}/v0/management/accounts`, `${this.baseUrl}/v0/management/usage`];
    for (const url of urls) {
      try {
        const response = await this.fetcher(url, { headers: headers(apiKey, managementKey) });
        if (response.status === 404) continue;
        return await readJsonResponse(response);
      } catch (error) {
        if (this.managementUrl) throw error;
      }
    }
    return null;
  }

  async readUsageDb(): Promise<JsonValue | null> {
    if (!this.usageDbPath) return null;
    const text = await readFile(this.usageDbPath, "utf8");
    try { return JSON.parse(text) as JsonValue; } catch { /* Try SQLite below. */ }
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(this.usageDbPath, { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
      return { tables: tables.map((table) => table.name) };
    } finally { db.close(); }
  }

  async readQuota(): Promise<JsonValue | null> {
    try {
      const result = await execFileAsync("quota-axi", ["--json", "--no-credential-refresh"], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(result.stdout) as JsonValue;
    } catch { return null; }
  }

  async facts(): Promise<GatewayFacts> {
    const [models, management, usage, quota] = await Promise.all([this.listModels(), this.readManagement(), this.readUsageDb(), this.readQuota()]);
    return { models, management, usage, quota, observedAt: new Date().toISOString() };
  }
}
