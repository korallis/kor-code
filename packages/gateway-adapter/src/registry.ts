import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GatewayCapability } from "@kor-code/core";

export interface ModelProbeResult {
  model: string;
  family: string;
  verified: boolean;
  capabilities: Partial<Record<GatewayCapability, boolean>>;
  costUsd?: number;
  durationMs?: number;
  observedAt: string;
  claudeCodeVersion?: string;
  error?: string;
}

export interface ModelRegistry { version: 1; models: ModelProbeResult[] }

export const MODEL_CAPABILITIES: readonly GatewayCapability[] = ["streaming", "tool_calls", "thinking", "structured_output"];

export function modelRegistryPath(): string {
  return process.env.KOR_MODEL_REGISTRY ?? `${process.env.XDG_STATE_HOME ?? `${process.env.HOME ?? "."}/.local/state`}/kor/models.json`;
}

export async function readModelRegistry(path = modelRegistryPath()): Promise<ModelRegistry> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) return { version: 1, models: [] };
    return { version: 1, models: (parsed as { models: ModelProbeResult[] }).models.filter(item => typeof item?.model === "string" && item.verified === true) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { version: 1, models: [] };
    throw new Error(`Cannot read model registry at ${path}`);
  }
}

export async function writeModelRegistry(results: readonly ModelProbeResult[], path = modelRegistryPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, models: results }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function registryCapabilities(registry: ModelRegistry): Record<string, Partial<Record<GatewayCapability, boolean>>> {
  return Object.fromEntries(registry.models.filter(item => item.verified).map(item => [item.model, item.capabilities]));
}
