import { randomUUID } from "node:crypto";
import type { Execution, VerificationAttempt } from "@kor-code/core";
import type { JevDecisionCore } from "@kor-code/jev";
import { metricFromSession, type CalibrationStore } from "@kor-code/calibration";
import type { Repository } from "./repository.js";
import type { SessionLauncherLike, SessionResult } from "./launcher.js";
import { repairPrompt, verifyAttempt, verificationSettings } from "./verification.js";

/** Both arms use the same checks, acceptance judge, prompt and repair budget. */
export async function runVerifiedSessions(input: {
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
}) {
  const { execution, repository, settings } = input;
  const attempts: VerificationAttempt[] = [];
  const race = <T>(action: Promise<T>): Promise<T> => input.leaseFailure ? Promise.race([action, input.leaseFailure]) : action;
  for (let repair = 0; ; repair += 1) {
    const attemptNumber = input.calibration?.nextAttempt(execution.id) ?? attempts.length + 1;
    const attemptId = input.reserveAttempt?.(execution.id, attemptNumber) ?? randomUUID();
    const previous = attempts.at(-1);
    const startedAt = new Date().toISOString();
    let session: SessionResult;
    try {
      session = await race(input.launcher.launch({ execution, repositoryPath: repository.path, worktreePath: execution.worktree,
        prompt: previous ? repairPrompt(input.initialPrompt, previous) : input.initialPrompt,
        ...(execution.route ? { route: execution.route } : {}), ...(repository.allowedTools ? { allowedTools: repository.allowedTools } : {}), ...(repository.checks ? { checks: repository.checks } : {}), ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}), ...(input.signal ? { signal: input.signal } : {}) }));
    } catch (error) {
      // Preserve the attempt and elapsed time even when the provider never emits a result.
      if (input.calibration && execution.route) input.calibration.recordAttempt(metricFromSession({ executionId: execution.id, attempt: attemptNumber, attemptId, ...(input.decisionId ? { decisionId: input.decisionId } : {}), route: execution.route, startedAt, finishedAt: new Date().toISOString(), session: {}, verified: false, verificationFailures: 0 }));
      throw error;
    }
    const attempt = await race(verifyAttempt({ execution, acceptance: execution.manifest?.acceptance ?? [], session, attempt: attemptNumber, attemptId,
      checks: repository.checks ?? [], baseRevision: input.baseRevision, ...(input.jev ? { jev: input.jev } : {}), enforceSemantic: repository.checks !== undefined || input.jev !== undefined, settings }));
    attempts.push(attempt);
    if (input.calibration && execution.route) input.calibration.recordAttempt(metricFromSession({ executionId: execution.id, attempt: attemptNumber, attemptId,
      ...(input.decisionId ? { decisionId: input.decisionId } : {}), route: execution.route, startedAt, finishedAt: new Date().toISOString(), session,
      verificationFailures: attempt.blockers.length > 0 ? 1 : 0, findings: attempt.findings, verified: attempt.blockers.length === 0 }));
    if (attempt.blockers.length === 0 || repair >= settings.maxRepairs) return { session, latest: attempt, verificationReport: { attempts, passed: attempt.blockers.length === 0 } };
  }
}
