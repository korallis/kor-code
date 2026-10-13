import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { questionSchema, parseResponse, type ChoiceAnswer, type JevQuestion, type JevResponse, type JevState } from "./contracts.js";
import { redact, runtimeSecrets } from "./redact.js";

export interface JevClientOptions { apiKey?: string; endpoint?: string; model?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }

async function keyFromRuntimeFile(): Promise<string | undefined> {
  try {
    const text = await readFile(join(homedir(), ".config/typesafe/env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?(?:TYPESAFE_API_KEY|TYPESAFE_KEY|JEV_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match?.[1]) continue;
      const raw = match[1];
      const quote = raw[0];
      const key = quote === "\"" || quote === "'" ? (raw.endsWith(quote) ? raw.slice(1, -1) : raw.slice(1)) : raw.replace(/\s+#.*$/, "");
      if (key) return key;
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new Error("Unable to read TypeSafe runtime credential file");
  }
  return undefined;
}
export async function resolveJevApiKey(explicit?: string): Promise<string | undefined> {
  return explicit || process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_KEY || process.env.JEV_API_KEY || await keyFromRuntimeFile();
}
export class JevRequestError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Jev request failed: HTTP ${status}; upstream body (capped and redacted): ${body || "<empty>"}`);
    this.name = "JevRequestError";
  }
}
async function readCapped(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = limit - length;
      chunks.push(next.value.byteLength <= remaining ? next.value : next.value.slice(0, remaining));
      length += Math.min(next.value.byteLength, remaining);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).toString("utf8");
}
async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length <= limit) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) throw new Error("Jev response exceeded its byte limit");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).toString("utf8");
}
export class JevClient {
  private readonly options: Required<Pick<JevClientOptions, "endpoint" | "model" | "fetch" | "timeoutMs">> & Pick<JevClientOptions, "apiKey">;
  constructor(options: JevClientOptions = {}) {
    this.options = { endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0", fetch: globalThis.fetch, timeoutMs: 30_000, ...options };
    const url = new URL(this.options.endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("Jev endpoint must use HTTPS or loopback HTTP");
    if (!Number.isFinite(this.options.timeoutMs) || this.options.timeoutMs <= 0) throw new Error("Invalid Jev timeout");
  }
  async evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
    const validated = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, questionSchema.parse(question)]));
    if (Object.keys(validated).length === 0) throw new Error("Jev evaluation requires at least one question");
    const key = await resolveJevApiKey(this.options.apiKey);
    if (!key) throw new Error("TypeSafe API key not found (set TYPESAFE_API_KEY or ~/.config/typesafe/env)");
    let response: Response;
    try {
      response = await this.options.fetch(this.options.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ state: redact(state, [key]), model: this.options.model, questions: redact(validated, [key]) }) });
    } catch (error) { throw new Error("Jev transport unavailable or timed out", { cause: error }); }
    if (!response.ok) {
      const body = await readCapped(response, 2048).catch(() => "");
      const safeBody = String(redact(body, [key, ...runtimeSecrets()])).slice(0, 2048);
      throw new JevRequestError(response.status, safeBody);
    }
    try { return parseResponse(JSON.parse(await readBounded(response, 1_048_576)), validated); }
    catch (error) { throw new Error("Jev response failed typed validation", { cause: error }); }
  }
  async choice<T extends string>(state: unknown, instructions: string, criteria: Record<T, string | null>): Promise<ChoiceAnswer & { choice: T }> {
    const response = await this.evaluate(state, { choice: { type: "choice", instructions, criteria } });
    const answer = response.answers.choice;
    if (!answer || answer.type !== "choice") throw new Error("Jev choice answer missing");
    // parseResponse proved the selected key belongs to criteria.
    return answer as ChoiceAnswer & { choice: T };
  }
}
