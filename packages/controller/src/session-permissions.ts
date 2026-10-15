import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export const DEFAULT_ALLOWED_TOOLS = ["Read"] as const;
const SEARCH_TOOLS = ["Glob", "Grep"] as const;

function toolName(permission: string): string { return permission.split("(", 1)[0] ?? permission; }

export function sessionTools(permissions: readonly string[], override?: readonly string[]): string[] {
  return [...new Set(override ?? [...permissions.map(toolName), ...SEARCH_TOOLS])].sort();
}

export async function sessionPermissions(input: { worktree: string; allowedTools: readonly string[]; checks: readonly string[]; tools?: readonly string[] }): Promise<string[]> {
  const permissions = new Set(input.allowedTools);
  for (const tool of SEARCH_TOOLS) {
    if (!input.tools || input.tools.includes(tool)) permissions.add(tool);
  }
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

export function permissionGuidance(permissions: readonly string[], checks: readonly string[], tools: readonly string[] = sessionTools(permissions)): string {
  const inspection = ["Read", ...SEARCH_TOOLS].filter(tool => tools.includes(tool));
  return `\n\nAvailable tools: ${tools.length ? tools.join(", ") : "none"}. Availability does not grant permission.\nExecution permissions (do not request broader permissions):\n${permissions.length ? permissions.join("\n") : "None."}\nStay in this isolated worktree.${inspection.length ? ` Use ${inspection.join(", ")} for inspection.` : ""} A denied call did not execute. Use only available tools and permitted commands for verification and report any required operation that remains blocked.\nKor will run these authoritative checks after your session:\n${checks.length ? checks.join("\n") : "No repository checks configured."}`;
}
