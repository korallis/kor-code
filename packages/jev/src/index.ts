import { readFile } from "node:fs/promises";
import type { JsonValue } from "@kor-code/core";

export interface ChoiceQuestion { type: "choice"; instructions: string | JsonValue; criteria: Record<string, string | null | JsonValue> }
export interface ChoiceAnswer { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
export interface JevChoiceResponse { model: string; answers: { [id: string]: ChoiceAnswer | undefined }; usage?: { input_tokens?: number; output_tokens?: number } }
export interface JevClientOptions { apiKey?: string; endpoint?: string; model?: string; fetch?: typeof globalThis.fetch }

async function keyFromRuntimeFile(): Promise<string | undefined> {
  const path = `${process.env.HOME ?? ""}/.config/typesafe/env`;
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?(?:TYPESAFE_API_KEY|TYPESAFE_KEY|JEV_API_KEY)\s*=\s*(.+?)\s*$/.exec(line);
      if (match?.[1]) return match[1].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* Missing runtime file is a normal blocked probe state. */ }
  return undefined;
}

export async function resolveJevApiKey(explicit?: string): Promise<string | undefined> {
  return explicit ?? process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_KEY ?? process.env.JEV_API_KEY ?? await keyFromRuntimeFile();
}

export class JevClient {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly explicitKey: string | undefined;

  constructor(options: JevClientOptions = {}) {
    this.endpoint = options.endpoint ?? "https://api.typesafe.ai/v1/systemone";
    this.model = options.model ?? "jev-1.13.0";
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.explicitKey = options.apiKey;
  }

  async choice<T extends string>(state: JsonValue, question: string, criteria: Record<T, string | null>): Promise<ChoiceAnswer & { choice: T }> {
    const key = await resolveJevApiKey(this.explicitKey);
    if (!key) throw new Error("TypeSafe API key not found (set TYPESAFE_API_KEY or ~/.config/typesafe/env)");
    const body = { state, model: this.model, questions: { choice: { type: "choice", instructions: question, criteria } } };
    const response = await this.fetcher(this.endpoint, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Jev request failed: HTTP ${response.status} ${await response.text()}`);
    const payload = await response.json() as JevChoiceResponse;
    const answer = payload.answers.choice;
    if (!answer || answer.type !== "choice") throw new Error("Jev response did not contain a choice answer");
    return answer as ChoiceAnswer & { choice: T };
  }
}
