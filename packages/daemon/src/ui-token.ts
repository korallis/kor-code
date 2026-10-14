import { randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { KorPaths } from "@kor-code/config";

/** The sole durable copy of the browser capability is in Kor's private state. */
export async function ensureUiToken(paths: KorPaths): Promise<string> {
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await chmod(paths.stateDir, 0o700);
  const file = join(paths.stateDir, "ui-token");
  const temporary = join(paths.stateDir, `.ui-token-${randomBytes(16).toString("hex")}`);
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${randomBytes(32).toString("hex")}\n`); }
    finally { await handle.close(); }
    await link(temporary, file);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  } finally { await unlink(temporary).catch(() => undefined); }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 128 || metadata.uid !== process.getuid?.()) throw new Error("Invalid UI token file");
    await handle.chmod(0o600);
    const token = (await handle.readFile("utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid UI token file");
    return token;
  } finally { await handle.close(); }
}

export function acceptsUiToken(authorization: string | undefined, token: string): boolean {
  const candidate = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
