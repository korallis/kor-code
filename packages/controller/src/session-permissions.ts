import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

/** Preserve configured capabilities; aliases only name the same executable script. */
export async function sessionPermissions(input: { worktree: string; allowedTools: readonly string[]; checks: readonly string[] }): Promise<string[]> {
  const permissions = new Set(input.allowedTools);
  const root = await realpath(input.worktree);
  for (const pattern of input.allowedTools) {
    const match = /^Bash\((bash|sh) ([A-Za-z0-9_./-]+)(\s*\*)?\)$/.exec(pattern);
    const script = match?.[2]?.replace(/^\.\//, "");
    if (!script || script.startsWith("/") || script.split("/").includes("..")) continue;
    const target = await realpath(resolve(root, script)).catch(() => undefined);
    if (!target) continue;
    const path = relative(root, target);
    if (!path || path === ".." || path.startsWith(`..${sep}`)) continue;
    const metadata = await stat(target);
    if (!metadata.isFile() || (metadata.mode & 0o111) === 0) continue;
    const shebang = (await readFile(target, "utf8")).split("\n", 1)[0] ?? "";
    const interpreter = /^#!\s*(?:\/usr\/bin\/env\s+|\/bin\/)(bash|sh)\s*$/.exec(shebang)?.[1];
    if (!interpreter || interpreter !== match?.[1]) continue;
    for (const command of [script, `./${script}`]) {
      permissions.add(`Bash(${command})`);
      if (match?.[3]) permissions.add(`Bash(${command} *)`);
    }
  }
  // Exact, operator-configured simple commands; never synthesize shell wildcards.
  for (const check of input.checks) {
    if (check.trim() && !/[\r\n$`;&|<>*()]/.test(check)) permissions.add(`Bash(${check})`);
  }
  return [...permissions];
}

export function permissionGuidance(permissions: readonly string[], checks: readonly string[]): string {
  return `\n\nExecution permissions (do not request broader permissions):\n${permissions.join("\n")}\nStay in this isolated worktree. Use Read, Glob and Grep for inspection when available; a denied call did not execute. Use only permitted commands for verification and report any required operation that remains blocked.\nKor will run these authoritative checks after your session:\n${checks.length ? checks.join("\n") : "No repository checks configured."}`;
}
