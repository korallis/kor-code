import { readFile } from "node:fs/promises";
import type { JsonValue, RouteFailureReason } from "@kor-code/core";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  throw new Error("Invalid JSON value from gateway");
}
// Credentials, identity and free-form diagnostics never cross the facts boundary.
export function publicJson(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(publicJson);
  if (record(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/key|token|secret|password|credential|authorization|email|path|message|detail|error|label|account$/i.test(key))
    .map(([key, item]) => [key, publicJson(item)]));
  if (typeof value === "string" && /bearer |sk-|eyJ|api.?key|token[=:]|password[=:]/i.test(value)) return "[REDACTED]";
  return json(value);
}
export interface RuntimeConfig { baseUrl: string; apiKey: string | undefined; managementKey: string | undefined }
export async function runtimeConfig(options: { baseUrl?: string; apiKey?: string; managementKey?: string }): Promise<RuntimeConfig> {
  const envFile: Record<string, string> = {};
  try {
    const body = await readFile(`${process.env.HOME ?? ""}/.config/cpa-management.env`, "utf8");
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?(CPA_BASE_URL|CPA_MANAGEMENT_KEY)\s*=\s*(.*?)\s*$/.exec(line);
      if (match?.[1] && match[2]) envFile[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (!record(error) || error.code !== "ENOENT") throw new Error("Cannot read CPA runtime environment file");
  }
  let apiKey = options.apiKey ?? process.env.CPA_API_KEY ?? process.env.KOR_GATEWAY_KEY;
  if (!apiKey && process.env.KOR_GATEWAY_KEY_FILE) {
    try { apiKey = (await readFile(process.env.KOR_GATEWAY_KEY_FILE, "utf8")).trim(); }
    catch { throw new Error("Cannot read KOR_GATEWAY_KEY_FILE"); }
  }
  const baseUrl = options.baseUrl ?? process.env.CPA_BASE_URL ?? envFile.CPA_BASE_URL ?? "http://127.0.0.1:8317";
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid CPA base URL");
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, managementKey: options.managementKey ?? process.env.CPA_MANAGEMENT_KEY ?? envFile.CPA_MANAGEMENT_KEY };
}
export function classify(status: number): RouteFailureReason {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "authentication";
  if (status === 502 || status === 503 || status === 504) return "provider_unavailable";
  return "unknown";
}
export class GatewayError extends Error {
  constructor(readonly status: number, readonly reason: RouteFailureReason = classify(status), readonly streamStarted = false) {
    // Omit arbitrary upstream bodies: even truncated JSON can contain an unknown secret.
    super(`CLIProxyAPI HTTP ${status}; reason=${reason}; streamStarted=${streamStarted}; upstream body=[REDACTED]`);
  }
}
export async function boundedBody(response: Response, limit = 4 * 1024 * 1024): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return body + decoder.decode();
      size += chunk.value.length;
      if (size > limit) throw new Error("Gateway response exceeds byte limit");
      body += decoder.decode(chunk.value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function readJson(response: Response): Promise<JsonValue> {
  if (!response.ok) { await response.body?.cancel(); throw new GatewayError(response.status); }
  try { return json(JSON.parse(await boundedBody(response))); }
  catch { throw new Error("Gateway returned invalid or oversized JSON"); }
}
