import { randomUUID } from "node:crypto";
import { repositoryKeyForIssue } from "@kor-code/config";
import { stableId } from "@kor-code/linear";
import { JevDecisionCore, JevUnavailableError, PersistentDecisionAuditLog, type DecisionRequest, type JevJsonValue } from "@kor-code/jev";
import type { AskRequest, AskResponse, MissionRun, SuggestedAction } from "@kor-code/mission-control";
import type { KorDaemon } from "./index.js";
import { ApiFailure } from "./api.js";

const RUN_LIMIT = 20;
const CONTEXT_BYTES = 6_000;
class UncertainRequest extends Error {}

function runLinks(run: MissionRun): NonNullable<AskResponse["links"]> {
  return [
    ...(run.issueUrl ? [{ label: run.issueKey ?? "Linear issue", url: run.issueUrl }] : []),
    { label: `Run ${run.issueKey ?? run.executionId}`, url: `#/agents/${encodeURIComponent(run.executionId)}` },
    ...(run.pullRequestUrl ? [{ label: "Pull request", url: run.pullRequestUrl }] : []),
  ];
}

/** Jev interprets; the daemon enforces scope and executes its typed choice. */
export async function askJev(daemon: KorDaemon, input: AskRequest): Promise<AskResponse> {
  const id = input.requestId ?? randomUUID();
  const audit = new PersistentDecisionAuditLog({
    read: key => daemon.store.readDecisionAudit(key),
    write: (key, at, payload) => daemon.store.writeDecisionAudit(key, at, payload),
    update: (key, at, payload) => daemon.store.updateDecisionAudit(key, at, payload),
  });
  const core = new JevDecisionCore(daemon.mission.jev(), audit);
  const respond = (answer: string, actions: SuggestedAction[] = [], links: AskResponse["links"] = [], provenance: AskResponse["provenance"] = "jev"): AskResponse => ({ schemaVersion: 1, id, answer, actions, links, provenance });
  const runs: MissionRun[] = [];
  const summaries: Array<{ executionId: string; issue: string; title: string; status: string; repository: string; error: string | null; route: string | null }> = [];
  const attention = (run: MissionRun) => ["blocked", "failed", "waiting"].includes(run.status) ? 0 : 1;
  for (const run of daemon.missionRuns().filter(run => !input.executionId || run.executionId === input.executionId).reverse().sort((a, b) => attention(a) - attention(b))) {
    const summary = { executionId: run.executionId, issue: run.issueKey ?? run.issueId, title: run.issueTitle?.slice(0, 160) ?? "", status: run.status, repository: run.repository ?? "", error: run.error?.slice(0, 200) ?? null, route: run.route?.model ?? null };
    if (runs.length >= RUN_LIMIT || Buffer.byteLength(JSON.stringify([...summaries, summary])) > CONTEXT_BYTES) break;
    summaries.push(summary);
    runs.push(run);
  }
  const context = { message: input.message, runs: summaries, totalRuns: daemon.status().runs.length, omittedRuns: daemon.status().runs.length - runs.length };
  const choose = async (stage: string, question: string, candidates: Record<string, JevJsonValue>, state: JevJsonValue = context): Promise<string> => {
    const decisionId = `intake-${id}-${stage}`;
    const request: DecisionRequest = { decisionId, executionId: `ask-${id}`, kind: "intake", question, state, inputs: [{ name: "message", value: input.message }], candidates: Object.keys(candidates), criteria: candidates, threshold: 0.7 };
    const previous = audit.get(decisionId);
    if (previous && previous.request.inputs[0]?.value !== input.message) throw new ApiFailure(409, "conflict", "Request ID was already used for another message");
    if (previous?.response.reasons.some(reason => reason.startsWith("Jev unavailable."))) throw new JevUnavailableError("Jev was unavailable for this request");
    let decision;
    try { decision = previous ? audit.replay(decisionId) : await core.decide(request); }
    catch (error) {
      if (!(error instanceof JevUnavailableError)) throw error;
      core.apply({ ...request, policyChecks: [{ name: "Jev reachable", result: "fail", reason: "Jev unavailable. No action taken." }] }, undefined);
      throw error;
    }
    if (!decision.applied) throw new UncertainRequest(`Jev is unsure how to interpret this request (${Math.round(decision.confidence * 100)}% confidence). Nothing was changed. Specify the project or issue and the outcome you want.`);
    return decision.choice;
  };

  try {
    const intent = await choose("intent", "Classify the user's request. Questions, explanations, hypothetical or quoted actions are question. new-work explicitly asks to build, fix or create work. Actions require an explicit instruction on existing work. Do not turn a question into an action. Select clarify if the request cannot be understood.", {
      question: "Answer a question using live facts; no side effects",
      "new-work": "Create a scoped engineering issue and start implementing it",
      approve: "Approve an existing verified run for publication (approve and ship)",
      retry: "Retry an existing failed, blocked or canceled run",
      stop: "Stop an existing run; requires destructive-action confirmation",
      prioritise: "Change the priority of an existing issue",
      queue: "Start or queue an existing Linear issue",
      clarify: "The request does not specify an intelligible question or action",
    });
    if (intent === "clarify") return respond("Specify a project and the work you want, an issue to act on, or a question about current work. Nothing was changed.");

    if (intent === "question") {
      const blocked = runs.filter(run => ["blocked", "failed", "waiting"].includes(run.status));
      const ready = runs.filter(run => run.status === "waiting" || run.pullRequestUrl);
      const decisions = (daemon.status().decisions?.value ?? []).filter(decision => runs.some(run => run.executionId === decision.executionId)).slice(-10);
      const describe = (list: MissionRun[]) => list.map(run => `${run.issueKey ?? run.issueId}: ${run.status}${run.error ? ` — ${run.error.slice(0, 200)}` : ""}${run.route ? `; model ${run.route.model} (${run.routeSource ?? "configured"})` : ""}`).join(". ");
      const answers = {
        status: runs.length ? describe(runs) : "There are no runs. Give me a work request and its project to create an issue and queue a run.",
        blockers: blocked.length ? describe(blocked) : "No runs currently need your input or report a failure.",
        shipping: ready.length ? describe(ready) : "No runs are currently waiting for approval or have a pull request to review.",
        projects: Object.entries(daemon.config.repos).map(([key, repo]) => `${key}: Linear team ${repo.linearTeam ?? key}, project ${repo.linearProject ?? "not configured"}`).join(". ") || "No projects are configured. Add one in Settings with its Linear team and project.",
        decisions: decisions.length ? decisions.map(decision => `${decision.kind}: ${decision.choice} (${Math.round(decision.confidence * 100)}%). ${decision.reasons.join(" ").slice(0, 200)}`).join(" ") : "There are no execution decisions in this run summary yet.",
      };
      const topic = await choose("question", "Classify the topic of the user's question. Select the topic from the wording of the question, not which run status happens to be present.", {
        status: "General overview: what is running, current progress or status",
        blockers: "What is blocked, failed, or needs the operator's input",
        shipping: "What can ship today, is ready for approval, or has a pull request",
        projects: "Which repositories or Linear projects are configured",
        decisions: "Why Jev chose a route, model, skill or another decision",
      });
      const answer = new Map(Object.entries(answers)).get(topic);
      if (!answer) throw new Error("Invalid live answer");
      const actions: SuggestedAction[] = topic === "shipping" ? ready.filter(run => run.status === "waiting").map(run => ({ kind: "approve", executionId: run.executionId, label: `Approve and ship ${run.issueKey ?? run.issueId}` }))
        : topic === "blockers" ? blocked.filter(run => ["failed", "blocked"].includes(run.status)).map(run => ({ kind: "retry", executionId: run.executionId, label: `Retry ${run.issueKey ?? run.issueId}` })) : [];
      return respond(`${answer}${context.omittedRuns ? ` Showing ${runs.length} of ${context.totalRuns} runs; open Agents for the rest.` : ""}`, actions, (topic === "shipping" ? ready : topic === "blockers" ? blocked : runs).flatMap(runLinks));
    }

    const linear = daemon.linearClient();
    if (!linear) throw new ApiFailure(503, "unavailable", "Linear is unavailable. No work was started.", "Connect Linear in Settings");
    if (intent === "new-work") {
      const projects = Object.entries(daemon.config.repos).slice(0, 50);
      if (!projects.length) return respond("Add a project in Settings with its checkout, Linear team and Linear project before giving Kor work. Nothing was created.");
      const selected = await choose("project", "Select exactly one configured repository explicitly named or clearly implied by the request. If more than one could apply, choose none. A single configured repository can be the default.", {
        ...Object.fromEntries(projects.map(([key, repo]) => [`project:${key}`, { repository: key, linearTeam: repo.linearTeam ?? key, linearProject: repo.linearProject ?? null }])), none: "No unique matching project; ask for its name",
      });
      const project = projects.find(([key]) => selected === `project:${key}`);
      if (!project) return respond("I could not identify one project. Name the configured project for this work. Nothing was created.");
      const [key, repository] = project;
      if (!repository.linearProject) return respond(`Set the Linear project for ${key} in Settings before creating work. Nothing was created.`);
      const teamKey = repository.linearTeam ?? key.split("/")[0] ?? key;
      if (repositoryKeyForIssue({ teamKey, projectId: repository.linearProject }, daemon.config) !== key) throw new Error("Project resolves to a different repository");
      if (!linear.createIssue) throw new ApiFailure(503, "unavailable", "Linear issue creation is unavailable");
      const catalogue = await daemon.mission.models();
      const models = catalogue.models.value.filter(model => model.compatibility === "verified");
      if (catalogue.models.provenance !== "live" || !models.length) return respond("No verified model is available to draft the issue. Restore the gateway and probe a model, then retry. Nothing was created.");
      const configured = models.find(model => model.id === daemon.config.defaultRoute.model) ?? (models.length === 1 ? models[0] : undefined);
      const model = configured?.id ?? await choose("draft-model", "Select a verified text model to draft a concise engineering issue. All candidates are available and verified.", Object.fromEntries(models.map(model => [model.id, { provider: model.provider ?? null, capabilities: model.capabilities }])));
      let draft;
      try { draft = await daemon.mission.draftWork(input.message, key, model); }
      catch { return respond("The issue drafting model is unavailable or returned invalid data. No issue was created. Check the gateway and verified models, then retry."); }
      const description = `${draft.summary}\n\n## Original request\n\n${input.message}\n\n## Acceptance\n\n${draft.acceptanceCriteria.map(criterion => `- ${criterion}`).join("\n")}`;
      const issue = await linear.createIssue({ id: stableId("kor-ask", id), teamKey, projectId: repository.linearProject, title: draft.title, description, labels: [...new Set(["kor", daemon.config.intakeLabel])] });
      let run;
      try { [run] = await daemon.queueIssues([issue.id]); }
      catch { return respond(`Created ${issue.identifier ?? issue.id} in ${key}, but its run could not be queued. Check the project mapping and queue the issue from Projects.`, [], issue.url ? [{ label: issue.identifier ?? issue.id, url: issue.url }] : []); }
      if (!run) throw new Error("Created issue has no run");
      core.recordOutcome(`intake-${id}-intent`, { issueId: issue.id, executionId: run.executionId, action: "create-and-queue", applied: true });
      return respond(`Created ${issue.identifier ?? issue.id} in ${key}. Its run is ${run.status}. Jev selects the execution route, model and skills through the normal preflight.`, [], runLinks(run));
    }

    const issues = await daemon.missionIssues(null);
    const candidates = [...new Map([...runs.map(run => ({ id: run.issueId, label: run.issueKey ?? run.issueId, title: run.issueTitle ?? "" })), ...(issues.issues.provenance === "live" ? issues.issues.value.map(issue => ({ id: issue.id, label: issue.identifier ?? issue.id, title: issue.title })) : [])].map(issue => [issue.id, issue])).values()].slice(0, 100);
    if (!candidates.length) return respond(issues.issues.provenance === "live" ? "There are no existing issues to act on. Give me a work request and its project to create one." : "Existing issues are unavailable. Check the Linear connection and try again. Nothing was changed.");
    const target = await choose("target", "Select the one existing issue explicitly referred to by the user's action, or the scoped run. Never guess between issues. Choose none if missing or ambiguous.", {
      ...Object.fromEntries(candidates.map(issue => [`issue:${issue.id}`, issue])), none: "No unique existing issue",
    }, { ...context, scopedExecution: input.executionId ?? null });
    const issue = candidates.find(issue => target === `issue:${issue.id}`);
    if (!issue) return respond("Specify the issue key or run to act on. Nothing was changed.");
    const fact = await linear.getIssue(issue.id);
    repositoryKeyForIssue(fact, daemon.config);
    if (intent === "prioritise") {
      const priority = await choose("priority", "Select the Linear priority explicitly requested. If no priority was specified, choose unspecified.", { "0": "No priority", "1": "Urgent", "2": "High", "3": "Normal", "4": "Low", unspecified: "No priority specified" });
      if (priority === "unspecified") return respond(`Specify urgent, high, normal, low or no priority for ${issue.label}. Nothing was changed.`);
      if (!linear.setPriority) throw new ApiFailure(503, "unavailable", "Linear priority changes are unavailable");
      await linear.setPriority(issue.id, Number(priority));
      daemon.store.setPriority(issue.id, Number(priority));
      core.recordOutcome(`intake-${id}-priority`, { issueId: issue.id, priority: Number(priority), applied: true });
      return respond(`Changed ${issue.label} to ${["no priority", "urgent", "high", "normal", "low"][Number(priority)]} priority in Linear and the run queue.`, [], fact.url ? [{ label: issue.label, url: fact.url }] : []);
    }
    if (intent === "queue") {
      const [run] = await daemon.queueIssues([issue.id]);
      if (!run) throw new Error("Queued issue has no run");
      return respond(`${issue.label}: its run is ${run.status}.`, [], runLinks(run));
    }
    const run = daemon.missionRun(issue.id);
    if (intent === "stop") return respond(`Confirm stopping ${issue.label}. Its current work will be interrupted.`, [{ kind: "cancel", executionId: run.executionId, label: `Stop ${issue.label}` }], runLinks(run));
    if (intent !== "approve" && intent !== "retry") throw new Error("Unsupported Jev action");
    await daemon.runAction(run.executionId, intent);
    core.recordOutcome(`intake-${id}-intent`, { executionId: run.executionId, action: intent, applied: true });
    const updated = daemon.missionRun(run.executionId);
    return respond(intent === "approve" ? `Approved ${issue.label} for publication. Shipping will now advance.` : `Retry accepted for ${issue.label}; its run is ${updated.status}.`, [], runLinks(updated));
  } catch (error) {
    if (error instanceof JevUnavailableError) return respond("Jev was unavailable or returned an invalid response. No action was taken; this is not a Jev recommendation. Check the Jev connection and retry.", [], [], "unavailable");
    if (error instanceof UncertainRequest) return respond(error.message, [], [], "uncertain");
    if (error instanceof Error && /repository mapping/.test(error.message)) return respond(`${error.message} Nothing was queued.`);
    throw error;
  }
}
