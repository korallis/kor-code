import type { Execution, Issue } from "@kor-code/core";
import { readFile } from "node:fs/promises";

export interface LinearClient {
  getIssue(id: string): Promise<Issue>;
  recordExecution(execution: Execution): Promise<void>;
}

export function createLinearClient(): LinearClient | null {
  return process.env.LINEAR_API_KEY ? null : null;
}

export interface LinearProbeResult { viewer: string; teams: string[]; workflowStates: string[] }

async function resolveLinearApiKey(): Promise<string | undefined> {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  try {
    const text = await readFile(`${process.env.HOME ?? ""}/.config/linear/env`, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?LINEAR_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (match?.[1]) return match[1].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* A missing key is reported as a blocked probe. */ }
  return undefined;
}

export async function probeLinearReadOnly(fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<LinearProbeResult> {
  const apiKey = await resolveLinearApiKey();
  if (!apiKey) throw new Error("no key: skipped");
  const response = await fetcher("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ query: "query KorFoundationProbe { viewer { name } teams { nodes { key name } } workflowStates { nodes { name type } } }" }),
  });
  if (!response.ok) throw new Error(`Linear request failed: HTTP ${response.status}`);
  const payload = await response.json() as { data?: { viewer?: { name?: string }; teams?: { nodes?: Array<{ key?: string; name?: string }> }; workflowStates?: { nodes?: Array<{ name?: string; type?: string }> }; errors?: Array<{ message?: string }> }; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  const data = payload.data;
  if (!data?.viewer || !data.teams || !data.workflowStates) throw new Error("Linear response omitted viewer, teams, or workflow states");
  return {
    viewer: data.viewer.name ?? "unknown",
    teams: (data.teams.nodes ?? []).map((team) => `${team.key ?? "?"} ${team.name ?? "?"}`),
    workflowStates: (data.workflowStates.nodes ?? []).map((state) => `${state.name ?? "?"} (${state.type ?? "?"})`),
  };
}
