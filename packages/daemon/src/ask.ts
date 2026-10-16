import { randomUUID } from "node:crypto";
import { repositoryKeyForIssue } from "@kor-code/config";
import { stableId } from "@kor-code/tracker";
import { JevDecisionCore, JevUnavailableError, PersistentDecisionAuditLog, type DecisionRequest, type JevJsonValue } from "@kor-code/jev";
import type { AskRequest, AskResponse, MissionRun, SuggestedAction } from "@kor-code/mission-control";
import type { KorDaemon } from "./index.js";
import { ApiFailure } from "./api.js";

const RUN_LIMIT = 20;
const CONTEXT_BYTES = 6_000;
class UncertainRequest extends Error {}

function runLinks(run: MissionRun): NonNullable<AskResponse["links"]> {
  return [
    ...(run.issueUrl ? [{ label: run.issueKey ?? "tracker issue", url: run.issueUrl }] : []),
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
    const intent = await choose("intent", "Classify the user's request. Questions, explanations, hypothetical or quoted actions are question. project-drive explicitly asks to work through, finish or complete a whole project's existing issues, including parallel development, monitoring and fixing. new-work explicitly asks to build, fix or create one new piece of work. Actions require an explicit instruction on existing work. Do not turn a question into an action. Select clarify if the request cannot be understood.", {
      question: "Answer a question using live facts; no side effects",
      "project-drive": "Drive a whole existing project to completion: queue ready issues, follow dependencies, monitor, repair and verify in parallel",
      "new-work": "Create a scoped engineering issue and start implementing it",
      approve: "Approve an existing verified run for publication (approve and ship)",
      retry: "Retry an existing failed, blocked or canceled run",
      stop: "Stop an existing run; requires destructive-action confirmation",
      prioritise: "Change the priority of an existing issue",
      queue: "Start or queue an existing tracker issue",
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
        projects: Object.entries(daemon.config.repos).map(([key, repo]) => `${key}: ${repo.tracker} ${repo.github?.repository ?? repo.linearProject ?? repo.linearTeam ?? key}`).join(". ") || "No projects are configured. Add one in Settings with its tracker team and project.",
        decisions: decisions.length ? decisions.map(decision => `${decision.kind}: ${decision.choice} (${Math.round(decision.confidence * 100)}%). ${decision.reasons.join(" ").slice(0, 200)}`).join(" ") : "There are no execution decisions in this run summary yet.",
        other: "I can answer questions about current runs, blockers, work ready to ship, configured projects and Jev decisions. I cannot answer this question from the live snapshot. Nothing was changed.",
      };
      const topic = await choose("question", "Classify the topic of the user's question. Select the topic from the wording of the question, not which run status happens to be present.", {
        status: "General overview: what is running, current progress or status",
        blockers: "What is blocked, failed, or needs the operator's input",
        shipping: "What can ship today, is ready for approval, or has a pull request",
        projects: "Which repositories or tracker projects are configured",
        decisions: "Why Jev chose a route, model, skill or another decision",
        other: "The question needs facts outside these topics or not present in the supplied snapshot, such as elapsed time, estimates or general knowledge",
      });
      const answer = new Map(Object.entries(answers)).get(topic);
      if (!answer) throw new Error("Invalid live answer");
      const actions: SuggestedAction[] = topic === "shipping" ? ready.filter(run => run.status === "waiting").map(run => ({ kind: "approve", executionId: run.executionId, label: `Approve and ship ${run.issueKey ?? run.issueId}` }))
        : topic === "blockers" ? blocked.filter(run => ["failed", "blocked"].includes(run.status)).map(run => ({ kind: "retry", executionId: run.executionId, label: `Retry ${run.issueKey ?? run.issueId}` })) : [];
      return respond(`${answer}${context.omittedRuns ? ` Showing ${runs.length} of ${context.totalRuns} runs; open Agents for the rest.` : ""}`, actions, (topic === "shipping" ? ready : topic === "blockers" ? blocked : runs).flatMap(runLinks));
    }

    const tracker = daemon.trackerClient();
    if (!tracker) throw new ApiFailure(503, "unavailable", "tracker is unavailable. No work was started.", "Connect tracker in Settings");
    if (intent === "project-drive") {
      const projects = await daemon.drives.projects();
      if (!projects.length) return respond("Configure a Linear project and checkout in Settings before starting a project drive. Nothing was queued.");
      const selected = await choose("drive-project", "Resolve the one project explicitly named or clearly implied by the request using the live Linear project names and configured repository keys. Choose none if ambiguous or no match. A single configured project can be the default.", {
        ...Object.fromEntries(projects.map(item => [`project:${item.repository}`, { repository: item.repository, ...item.project }])), none: "No unique matching configured Linear project",
      });
      const target = projects.find(item => selected === `project:${item.repository}`);
      if (!target) return respond("I could not identify one configured project. Name its Linear project or repository. Nothing was queued.");
      const drive = await daemon.drives.start(target.repository, target.project, stableId("kor-drive", id));
      const count = (status: string) => drive.issues.filter(issue => issue.status === status).length;
      core.recordOutcome(`intake-${id}-intent`, { action: "project-drive", driveId: drive.id, repository: drive.repository, applied: true });
      return respond(`Project drive for ${drive.name}: ${count("queued")} queued, ${count("pending")} waiting for blockers, ${count("running")} running, ${count("review")} in review, ${count("done")} Done and ${count("held")} held. Kor runs within your limits and keeps verification and merge gates. ${drive.status === "paused" ? "This drive is paused; resume it in Mission Control." : "Pause or stop it in Mission Control."}${drive.error ? ` Synchronization will retry: ${drive.error}` : ""}`, [], [{ label: drive.name, url: drive.url }, { label: "Project drive progress", url: `#/projects/${encodeURIComponent(drive.repository)}` }]);
    }
    if (intent === "new-work") {
      const projects = Object.entries(daemon.config.repos).slice(0, 50);
      if (!projects.length) return respond("Add a project in Settings with its checkout, tracker team and tracker project before giving Kor work. Nothing was created.");
      const selected = await choose("project", "Select exactly one configured repository explicitly named or clearly implied by the request. If more than one could apply, choose none. A single configured repository can be the default.", {
        ...Object.fromEntries(projects.map(([key, repo]) => [`project:${key}`, { repository: key, tracker: repo.tracker }])), none: "No unique matching project; ask for its name",
      });
      const project = projects.find(([key]) => selected === `project:${key}`);
      if (!project) return respond("I could not identify one project. Name the configured project for this work. Nothing was created.");
      const [key] = project;
      if (!tracker.createProjectIssue) throw new ApiFailure(503, "unavailable", "Tracker issue creation is unavailable");
      const catalogue = await daemon.mission.models();
      const models = catalogue.models.value.filter(model => model.compatibility === "verified");
      if (catalogue.models.provenance !== "live") return respond("The gateway model catalogue is unavailable. Check the gateway connection in Settings and retry. Nothing was created.");
      if (!models.length) return daemon.deferAsk({ ...input, requestId: id });
      const configured = models.find(model => model.id === daemon.config.defaultRoute.model) ?? (models.length === 1 ? models[0] : undefined);
      const model = configured?.id ?? await choose("draft-model", "Select a verified text model to draft a concise engineering issue. All candidates are available and verified.", Object.fromEntries(models.map(model => [model.id, { provider: model.provider ?? null, capabilities: model.capabilities }])));
      let draft;
      try { draft = await daemon.mission.draftWork(input.message, key, model); }
      catch { return respond("The issue drafting model is unavailable or returned invalid data. No issue was created. Check the gateway and verified models, then retry."); }
      const description = `${draft.summary}\n\n## Original request\n\n${input.message}\n\n## Acceptance\n\n${draft.acceptanceCriteria.map(criterion => `- ${criterion}`).join("\n")}`;
      const issue = await tracker.createProjectIssue({ id: stableId("kor-ask", id), repositoryKey: key, title: draft.title, description, labels: [...new Set(["kor", daemon.config.intakeLabel])] });
      let run;
      try { [run] = await daemon.queueIssues([issue.id]); }
      catch { return respond(`Created ${issue.identifier ?? issue.id} in ${key}, but its run could not be queued. Check the project mapping and queue the issue from Projects.`, [], issue.url ? [{ label: issue.identifier ?? issue.id, url: issue.url }] : []); }
      if (!run) throw new Error("Created issue has no run");
      core.recordOutcome(`intake-${id}-intent`, { issueId: issue.id, executionId: run.executionId, action: "create-and-queue", applied: true });
      return respond(`Created ${issue.identifier ?? issue.id} in ${key}. Its run is ${run.status}. Jev selects the execution route, model and skills through the normal preflight.`, [], runLinks(run));
    }

    const issues = await daemon.missionIssues(null);
    const candidates = [...new Map([...runs.map(run => ({ id: run.issueId, label: run.issueKey ?? run.issueId, title: run.issueTitle ?? "" })), ...(issues.issues.provenance === "live" ? issues.issues.value.map(issue => ({ id: issue.id, label: issue.identifier ?? issue.id, title: issue.title })) : [])].map(issue => [issue.id, issue])).values()].slice(0, 100);
    if (!candidates.length) return respond(issues.issues.provenance === "live" ? "There are no existing issues to act on. Give me a work request and its project to create one." : "Existing issues are unavailable. Check the tracker connection and try again. Nothing was changed.");
    const target = await choose("target", "Select the one existing issue explicitly referred to by the user's action, or the scoped run. Never guess between issues. Choose none if missing or ambiguous.", {
      ...Object.fromEntries(candidates.map(issue => [`issue:${issue.id}`, issue])), none: "No unique existing issue",
    }, { ...context, scopedExecution: input.executionId ?? null });
    const issue = candidates.find(issue => target === `issue:${issue.id}`);
    if (!issue) return respond("Specify the issue key or run to act on. Nothing was changed.");
    const fact = await tracker.getIssue(issue.id);
    repositoryKeyForIssue(fact, daemon.config);
    if (intent === "prioritise") {
      const priority = await choose("priority", "Select the tracker priority explicitly requested. If no priority was specified, choose unspecified.", { "0": "No priority", "1": "Urgent", "2": "High", "3": "Normal", "4": "Low", unspecified: "No priority specified" });
      if (priority === "unspecified") return respond(`Specify urgent, high, normal, low or no priority for ${issue.label}. Nothing was changed.`);
      if (!tracker.setPriority) throw new ApiFailure(503, "unavailable", "tracker priority changes are unavailable");
      await tracker.setPriority(issue.id, Number(priority));
      daemon.store.setPriority(issue.id, Number(priority));
      core.recordOutcome(`intake-${id}-priority`, { issueId: issue.id, priority: Number(priority), applied: true });
      return respond(`Changed ${issue.label} to ${["no priority", "urgent", "high", "normal", "low"][Number(priority)]} priority in tracker and the run queue.`, [], fact.url ? [{ label: issue.label, url: fact.url }] : []);
    }
    if (intent === "queue") {
      const [run] = await daemon.queueIssues([issue.id]);
      if (!run) throw new Error("Queued issue has no run");
      return respond(`${issue.label}: its run is ${run.status}.`, [], runLinks(run));
    }
    const run = daemon.missionRuns().find(run => run.issueId === issue.id);
    if (!run) return respond(`${issue.label} has no run to act on. Ask me to queue it to start work.`, [], fact.url ? [{ label: issue.label, url: fact.url }] : []);
    if (intent === "stop") return respond(`Confirm stopping ${issue.label}. Its current work will be interrupted.`, [{ kind: "cancel", executionId: run.executionId, label: `Stop ${issue.label}` }], runLinks(run));
    if (intent !== "approve" && intent !== "retry") throw new Error("Unsupported Jev action");
    try { await daemon.runAction(run.executionId, intent); }
    catch (error) {
      if (error instanceof ApiFailure && error.status === 409) return respond(`${issue.label}: ${error.message}. Nothing was changed.`, [], runLinks(run));
      throw error;
    }
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
