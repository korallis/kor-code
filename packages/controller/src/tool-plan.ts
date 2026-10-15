import { createHash } from "node:crypto";
import { JevUnavailableError, type AppliedDecision, type DecisionRequest, type JevDecisionCore } from "@kor-code/jev";
import { sessionTools } from "./session-permissions.js";

const TOOL_THRESHOLD = 0.8;
const WEB_TOOLS = ["WebFetch", "WebSearch"];
const BROWSER_PREFIXES = ["mcp__chrome_devtools__", "mcp__playwright__", "mcp__browser__"];
function browserTool(tool: string): boolean { return BROWSER_PREFIXES.some(prefix => tool.startsWith(prefix)); }
const CAPABILITIES = [
  { name: "shell", question: "Does this task require shell commands beyond read-only git inspection?", yes: "Building, running checks, installing dependencies or executing a script is necessary.", no: "Reading and editing files with ordinary repository inspection suffices." },
  { name: "browser", question: "Does this task require interacting with a live browser?", yes: "The task requires rendering pages, interacting with a UI or capturing browser screenshots.", no: "Repository edits or fetching source documents suffice; no browser interaction is required." },
  { name: "web", question: "Does this task require fetching current documents or evidence from the web?", yes: "External URLs or current primary sources must be fetched to complete the requested work.", no: "The supplied task and repository contain enough information; no external fetch is needed." },
  { name: "subagents", question: "Does this task require sub-agents?", yes: "The task explicitly requests delegation or requires independent parallel investigations across multiple systems.", no: "One worker can finish the bounded change using ordinary repository context." },
];

export async function planSessionTools(input: {
  executionId: string;
  task: string;
  permissions: readonly string[];
  tools?: readonly string[];
  jev?: JevDecisionCore;
  /** Operator edits by tool name; they apply within repository policy only. */
  overrides?: ReadonlyMap<string, boolean>;
}): Promise<{ tools: string[]; decisions: AppliedDecision[]; fallback: boolean }> {
  const permitted = sessionTools(input.permissions);
  const eligible = sessionTools(input.permissions, input.tools).filter(tool => permitted.includes(tool));
  const lean = eligible.filter(tool => !WEB_TOOLS.includes(tool) && tool !== "Agent" && !browserTool(tool));
  const jev = input.jev;
  const overridden = (tools: Iterable<string>) => {
    const result = new Set(tools);
    for (const [tool, present] of input.overrides ?? []) {
      if (!present) result.delete(tool);
      else if (eligible.includes(tool)) result.add(tool);
    }
    return [...result].sort();
  };
  if (!jev) return { tools: overridden(lean), decisions: [], fallback: true };
  const revision = createHash("sha256").update(JSON.stringify({ task: input.task, permissions: [...input.permissions].sort(), eligible })).digest("hex").slice(0, 16);
  const requests: DecisionRequest[] = CAPABILITIES.map(capability => {
    const tools = eligible.filter(tool => capability.name === "shell" ? tool === "Bash"
      : capability.name === "web" ? WEB_TOOLS.includes(tool)
      : capability.name === "subagents" ? tool === "Agent"
      : browserTool(tool));
    return {
      decisionId: `tools-${input.executionId}-${revision}-${capability.name}`, executionId: input.executionId,
      kind: "tools", answerType: "noul", question: capability.question,
      state: { task: input.task, capability: capability.name, eligibleTools: tools },
      inputs: [{ name: "capability", value: capability.name }, { name: "eligibleTools", value: tools, source: "repository-policy" }],
      candidates: ["yes", "no"], criteria: { true: capability.yes, false: capability.no }, threshold: TOOL_THRESHOLD,
      policyChecks: [{ name: "tools-allowed", result: tools.length ? "pass" : "fail", reason: tools.length ? "Repository policy permits this capability." : "Repository policy provides no tools for this capability." }],
    };
  });
  const decisions: AppliedDecision[] = [];
  const pending: DecisionRequest[] = [];
  for (const request of requests) {
    try { decisions.push(jev.replay(request.decisionId)); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Decision not found:")) throw error;
      pending.push(request);
    }
  }
  let fallback = false;
  try { decisions.push(...(await jev.preflight(pending)).decisions); }
  catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    fallback = true;
    for (const request of pending) decisions.push(jev.apply({ ...request, policyChecks: [...request.policyChecks ?? [], { name: "jev-available", result: "fail", reason: "Jev unavailable; using the lean tool fallback." }] }, undefined));
  }
  fallback ||= decisions.some(decision => decision.policyChecks.some(check => check.name === "jev-available" && check.result === "fail"));
  const tools = new Set(lean);
  for (const decision of decisions) {
    if (!decision.applied || decision.choice !== "yes" || (decision.noul ?? 0) < TOOL_THRESHOLD) continue;
    const request = requests.find(request => request.decisionId === decision.decisionId);
    const candidates = request?.inputs.find(input => input.name === "eligibleTools")?.value;
    if (Array.isArray(candidates)) for (const tool of candidates) if (typeof tool === "string" && eligible.includes(tool)) tools.add(tool);
  }
  return { tools: overridden(tools), decisions, fallback };
}
