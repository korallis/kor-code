import { randomUUID } from "node:crypto";
import type { Execution, SessionSpend, VerificationAttempt } from "@kor-code/core";
import type { JevDecisionCore, SessionOverrides } from "@kor-code/jev";
import { metricFromSession, type CalibrationStore } from "@kor-code/calibration";
import type { Repository } from "./repository.js";
import type { SessionLauncherLike, SessionResult } from "./launcher.js";
import { repairPrompt, verifyAttempt, verificationSettings } from "./verification.js";
import { DEFAULT_ALLOWED_TOOLS, sessionPermissions } from "./session-permissions.js";
import { planSessionTools } from "./tool-plan.js";

/** Both arms use the same checks, acceptance judge, prompt and repair budget. */
export async function runVerifiedSessions(input: {
  skillsDisabled?: boolean;
  pairedTools?: readonly (readonly string[] | null)[];
  execution: Execution;
  repository: Repository;
  initialPrompt: string;
  baseRevision: string;
  launcher: SessionLauncherLike;
  jev?: JevDecisionCore;
  settings: ReturnType<typeof verificationSettings>;
  calibration?: CalibrationStore;
  decisionId?: string;
  /** Persist a fresh identity before launch; ephemeral consumers may omit persistence. */
  reserveAttempt?: (executionId: string, attempt: number) => string;
  leaseFailure?: Promise<never>;
  onSpawn?: (pid: number) => void;
  signal?: AbortSignal;
  onStage?: (executionId: string, stage: "execute" | "verify") => void;
  onSpend?: (executionId: string, spend: SessionSpend) => void;
  /** Operator overrides in force, read before every session so an edit reaches the next one. */
  overrides?: () => SessionOverrides;
}) {
  const { execution, repository, settings } = input;
  const attempts: VerificationAttempt[] = [];
  const costs: Array<number | undefined> = [];
  const race = <T>(action: Promise<T>): Promise<T> => input.leaseFailure ? Promise.race([action, input.leaseFailure]) : action;
  for (let repair = 0; ; repair += 1) {
    const attemptNumber = input.calibration?.nextAttempt(execution.id) ?? attempts.length + 1;
    const attemptId = input.reserveAttempt?.(execution.id, attemptNumber) ?? randomUUID();
    const previous = attempts.at(-1);
    const startedAt = new Date().toISOString();
    let session: SessionResult;
    try {
      input.onStage?.(execution.id, "execute");
      const prompt = previous ? repairPrompt(input.initialPrompt, previous) : input.initialPrompt;
      const overrides = input.overrides?.();
      const permissions = await race(sessionPermissions({ worktree: execution.worktree, allowedTools: repository.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
        checks: repository.checks ?? [], ...(repository.tools ? { tools: repository.tools } : {}) }));
      const pairedTools = input.pairedTools?.[repair] ?? input.pairedTools?.at(-1);
      const toolPlan = pairedTools ? { tools: pairedTools } : await race(planSessionTools({ executionId: execution.id, task: prompt, permissions,
        ...(repository.tools ? { tools: repository.tools } : {}), ...(input.jev ? { jev: input.jev } : {}), ...(overrides ? { overrides: overrides.tools } : {}) }));
      session = await race(input.launcher.launch({ attemptId, ...(previous ? { playbookFailure: {
        classes: [...(previous.checks.some(check => check.status !== "pass") ? ["check-failure"] : []),
          ...(previous.findings.some(finding => finding.status !== "pass") ? ["acceptance-failure"] : []),
          ...(previous.evidence.some(item => item.kind === "policy" && item.status !== "pass") ? ["policy-denial"] : [])],
        blockers: previous.blockers,
      } } : {}), ...(overrides?.playbook !== undefined ? { playbookOverride: overrides.playbook } : {}), ...(overrides?.skills.size ? { skillOverrides: { skills: overrides.skills, confirmed: overrides.confirmed } } : {}),
        skillStage: previous ? "repair" : "execute", execution, repositoryPath: repository.path, worktreePath: execution.worktree,
        prompt, tools: toolPlan.tools,
        ...(input.skillsDisabled ? { skillsDisabled: true } : {}),
        ...(execution.route ? { route: execution.route } : {}), ...(repository.allowedTools ? { allowedTools: repository.allowedTools } : {}), ...(repository.checks ? { checks: repository.checks } : {}), ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}), ...(input.signal ? { signal: input.signal } : {}) }));
    } catch (error) {
      // Preserve the attempt and elapsed time even when the provider never emits a result.
      if (input.calibration && execution.route) input.calibration.recordAttempt(metricFromSession({ executionId: execution.id, attempt: attemptNumber, attemptId, ...(input.decisionId ? { decisionId: input.decisionId } : {}), route: execution.route, startedAt, finishedAt: new Date().toISOString(), session: {}, verified: false, verificationFailures: 0 }));
      throw error;
    }
    input.onStage?.(execution.id, "verify");
    if (execution.route) {
      const metric = metricFromSession({ executionId: execution.id, attempt: attemptNumber, attemptId, route: execution.route, startedAt, finishedAt: new Date().toISOString(), session, verified: false });
      input.onSpend?.(execution.id, { attempt: attemptNumber, attemptId, recordedAt: metric.recordedAt, model: metric.model, costUsd: metric.costUsd,
        inputTokens: metric.inputTokens, outputTokens: metric.outputTokens, cacheReadTokens: metric.cacheReadTokens, cacheCreationTokens: metric.cacheCreationTokens,
        ...(session.skillPack ? { skillPack: session.skillPack } : {}) });
    }
    costs.push(session.telemetry?.totalCostUsd);
    const attempt = await race(verifyAttempt({ execution, acceptance: execution.manifest?.acceptance ?? [], session, attempt: attemptNumber, attemptId,
      checks: repository.checks ?? [], baseRevision: input.baseRevision, ...(input.jev ? { jev: input.jev } : {}), enforceSemantic: repository.checks !== undefined || input.jev !== undefined, settings }));
    attempts.push(attempt);
    if (input.calibration && execution.route) input.calibration.recordAttempt(metricFromSession({ executionId: execution.id, attempt: attemptNumber, attemptId,
      ...(input.decisionId ? { decisionId: input.decisionId } : {}), route: execution.route, startedAt, finishedAt: new Date().toISOString(), session,
      verificationFailures: attempt.blockers.length > 0 ? 1 : 0, findings: attempt.findings, verified: attempt.blockers.length === 0 }));
    if (attempt.blockers.length === 0 || repair >= settings.maxRepairs) {
      const measured = costs.filter((cost): cost is number => cost !== undefined);
      return { session, latest: attempt, verificationReport: { attempts, passed: attempt.blockers.length === 0, ...(measured.length === costs.length ? { costUsd: measured.reduce((sum, cost) => sum + cost, 0) } : {}) } };
    }
  }
}
