import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const AUTH_HINT = "Run gh auth login --hostname github.com, set GH_TOKEN or GITHUB_TOKEN with repository write access, or save a token in Settings.";

export type GitHubRequest = (path: string, body?: unknown) => Promise<unknown>;

export async function githubRequest(path: string, body?: unknown, environment: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  let token = environment.GH_TOKEN || environment.GITHUB_TOKEN;
  if (!token) {
    try { token = (await exec("gh", ["auth", "token", "--hostname", "github.com"], { env: environment, timeout: 5_000 })).stdout.trim(); }
    catch { throw new Error(`GitHub authentication unavailable. ${AUTH_HINT}`); }
  }
  if (!token) throw new Error(`GitHub authentication unavailable. ${AUTH_HINT}`);
  const response = await fetch(`https://api.github.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GitHub API HTTP ${response.status}. ${response.status === 401 || response.status === 403 || response.status === 404 ? AUTH_HINT : "Check GitHub availability and retry."}`);
  }
  return response.json();
}
