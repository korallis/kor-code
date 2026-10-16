import { GitHubApiError } from "@kor-code/tracker";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const AUTH_HINT = "Run gh auth login --hostname github.com, set GH_TOKEN or GITHUB_TOKEN with repository write access, or save a token in Settings.";

export type GitHubRequest = (path: string, body?: unknown, method?: "PUT" | "PATCH" | "DELETE") => Promise<unknown>;

export async function githubRequest(path: string, body?: unknown, environment: NodeJS.ProcessEnv = process.env, method?: "PUT" | "PATCH" | "DELETE"): Promise<unknown> {
  let token = environment.GH_TOKEN || environment.GITHUB_TOKEN;
  if (!token) {
    try { token = (await exec("gh", ["auth", "token", "--hostname", "github.com"], { env: environment, timeout: 5_000 })).stdout.trim(); }
    catch { throw new Error(`GitHub authentication unavailable. ${AUTH_HINT}`); }
  }
  if (!token) throw new Error(`GitHub authentication unavailable. ${AUTH_HINT}`);
  const response = await fetch(`https://api.github.com${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GitHubApiError(response.status, `GitHub API HTTP ${response.status}. ${response.status === 401 || response.status === 403 || response.status === 404 ? AUTH_HINT : "Check GitHub availability and retry."}`);
  }
  const scopesHeader = response.headers.get("x-oauth-scopes");
  if (scopesHeader !== null) {
    const scopes = scopesHeader.split(",").map(scope => scope.trim());
    const projectRequest = path === "/graphql" && typeof body === "object" && body !== null && "query" in body && typeof body.query === "string" && /projectV2|ProjectV2/.test(body.query);
    if (projectRequest && !scopes.includes("project")) { await response.body?.cancel(); throw new Error("GitHub tracker is missing project scope; run gh auth refresh -s project or grant Projects read/write"); }
  }
  if (response.status === 204) return null;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("GitHub response is empty");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error("GitHub response exceeds page size limit; narrow the requested fields");
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); }
}
