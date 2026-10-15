import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GatewayCapability } from "@kor-code/core";
import type { ModelCatalogue } from "./index.js";
import { modelProvider } from "./models.js";

export interface ModelProbeResult {
  model: string;
  family: string;
  provider?: string;
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
    return { version: 1, models: (parsed as { models: ModelProbeResult[] }).models.filter(item => typeof item?.model === "string" && typeof item.verified === "boolean").map(item => {
      // Older probes marked missing thinking output false; that evidence means unknown.
      const verified = item.verified && item.capabilities?.streaming === true && item.capabilities.tool_calls === true && item.capabilities.structured_output === true;
      const capabilities = { ...item.capabilities };
      if (capabilities.thinking === false) delete capabilities.thinking;
      return { ...item, capabilities, verified };
    }) };
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

export function availableVerifiedModels(registry: ModelRegistry, catalogue: ModelCatalogue): ModelProbeResult[] {
  const models = new Map((catalogue.data ?? []).map(model => [model.id, model]));
  return registry.models.filter(result => result.verified && models.has(result.model))
    .map(result => ({ ...result, provider: modelProvider(result.model, models.get(result.model)?.owned_by ?? result.provider) }));
}

/** A catalogue outage must not discard saved verification evidence. */
export async function loadAvailableVerifiedModels(registry: ModelRegistry, loadCatalogue: () => Promise<ModelCatalogue>, onUnavailable?: () => void): Promise<ModelProbeResult[]> {
  let catalogue: ModelCatalogue;
  try { catalogue = await loadCatalogue(); }
  catch {
    onUnavailable?.();
    return registry.models.filter(result => result.verified)
      .map(result => ({ ...result, provider: modelProvider(result.model, result.provider) }));
  }
  return availableVerifiedModels(registry, catalogue);
}
