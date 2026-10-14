import { lstat, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

export const PLUGIN_ID = "kor-cockpit@kor";
const objectSchema = z.record(z.string(), z.unknown());
const settingsSchema = z.looseObject({
  enabledPlugins: z.record(z.string(), z.boolean()).optional(),
  extraKnownMarketplaces: objectSchema.optional(),
});
const pluginsSchema = z.looseObject({ version: z.literal(2), plugins: objectSchema });
export const installedPluginSchema = z.looseObject({
  scope: z.enum(["local", "user"]), installPath: z.string(), projectPath: z.string().optional(),
});
export type RegistryKind = "marketplaces" | "plugins";

export async function readObject(path: string): Promise<z.infer<typeof objectSchema>> {
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}; throw error; }
  try { const value: unknown = JSON.parse(source); return objectSchema.parse(value); }
  catch { throw new Error(`Invalid JSON object: ${path}`); }
}

export async function writeObject(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function withoutKor(value: z.infer<typeof objectSchema>, kind: RegistryKind): z.infer<typeof objectSchema> {
  if (kind === "marketplaces") { const { kor: _kor, ...rest } = value; return rest; }
  const registry = pluginsSchema.parse(Object.keys(value).length ? value : { version: 2, plugins: {} });
  const { [PLUGIN_ID]: _kor, ...plugins } = registry.plugins;
  return { ...registry, plugins };
}

export async function registryRestoration(current: string, backup: string, kind: RegistryKind): Promise<{ original: boolean; value: z.infer<typeof objectSchema> }> {
  const value = withoutKor(await readObject(current), kind);
  return { original: isDeepStrictEqual(value, withoutKor(await readObject(backup), kind)), value };
}

export async function addKorSettings(path: string, stagedPath: string): Promise<void> {
  const original = settingsSchema.parse(await readObject(path));
  const staged = settingsSchema.parse(await readObject(stagedPath));
  if (staged.enabledPlugins?.[PLUGIN_ID] !== true || !staged.extraKnownMarketplaces?.kor) throw new Error("Claude did not prepare the Kor settings");
  await writeObject(path, { ...original,
    enabledPlugins: { ...original.enabledPlugins, [PLUGIN_ID]: true },
    extraKnownMarketplaces: { ...original.extraKnownMarketplaces, kor: staged.extraKnownMarketplaces.kor },
  });
}

/** Claude reformats settings and expands this legacy alias at session startup. */
export async function sameClaudeSettings(current: string, snapshot: string): Promise<boolean> {
  function normalize(value: z.infer<typeof objectSchema>) {
    return value.model === "opus" ? { ...value, model: "opus[1m]" } : value;
  }
  if (((await lstat(current)).mode & 0o777) !== ((await lstat(snapshot)).mode & 0o777)) return false;
  return isDeepStrictEqual(normalize(await readObject(current)), normalize(await readObject(snapshot)));
}
