import type { SessionTurn, SessionLoadEvent, SessionGatewayTelemetry } from "./context.js";
import type { Route, SessionSkillPackRecord } from "@kor-code/core";
export interface SessionTelemetryLike {
  gateway?: SessionGatewayTelemetry;
  permissionDenials: number;
  turns?: readonly SessionTurn[];
  startContextTokens?: number;
  contextTokenSum?: number;
  loadEvents?: readonly SessionLoadEvent[];
  totalCostUsd?: number;
  durationMs?: number;
  model?: string;
  usage?: Readonly<Record<string, number>>;
  apiErrorStatus?: number;
}
export interface SessionResultLike { telemetry?: SessionTelemetryLike; skillDecisionId?: string; skillPack?: SessionSkillPackRecord; tools?: readonly string[] }
import { metricSchema, type CalibrationRun, type CalibrationStore, type RunMetric, type RunOutcome } from "./store.js";

export interface SessionMetricInput {
  executionId: string;
  attempt: number;
  attemptId?: string;
  decisionId?: string;
  route: Route;
  startedAt: string;
  finishedAt: string;
  session: SessionResultLike;
  verificationFailures?: number;
  findings?: RunMetric["findings"];
  policyBlocks?: number;
  clarifications?: number;
  failovers?: number;
  verified: boolean;
}

function usageValue(usage: Readonly<Record<string, number>> | undefined, ...names: string[]): number | null {
  for (const name of names) {
    const value = usage?.[name];
    if (value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}
function elapsed(startedAt: string, finishedAt: string): number {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) throw new Error("Session metric timestamps are invalid");
  return finish - start;
}

/** Converts one stream-json result into the durable metric shape. Missing provider fields stay null. */
export function metricFromSession(input: SessionMetricInput): RunMetric {
  const telemetry = input.session.telemetry;
  const inputTokens = usageValue(telemetry?.usage, "input_tokens", "inputTokens");
  const outputTokens = usageValue(telemetry?.usage, "output_tokens", "outputTokens");
  const cacheReadTokens = usageValue(telemetry?.usage, "cache_read_input_tokens", "cacheReadInputTokens");
  const cacheCreationTokens = usageValue(telemetry?.usage, "cache_creation_input_tokens", "cacheCreationInputTokens");
  return metricSchema.parse({
    ...(input.session.skillDecisionId ? { skillDecisionId: input.session.skillDecisionId } : {}),
    skillPack: input.session.skillPack ?? null,
    tools: input.session.tools ?? null,
    executionId: input.executionId,
    attempt: input.attempt,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    recordedAt: input.finishedAt,
    ...(input.decisionId ? { decisionId: input.decisionId } : {}),
    model: telemetry?.model ?? input.route.model,
    costUsd: telemetry?.totalCostUsd ?? null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    startContextTokens: telemetry?.startContextTokens ?? null,
    contextTokenSum: telemetry?.contextTokenSum ?? null,
    turns: telemetry?.turns ?? null,
    loadEvents: telemetry?.loadEvents ?? null,
    gateway: telemetry?.gateway ?? null,
    wallClockMs: elapsed(input.startedAt, input.finishedAt),
    sessionDurationMs: telemetry?.durationMs ?? null,
    // Claude's result event exposes the upstream API status when a provider
    // failover was observed. A missing status remains unavailable rather than
    // pretending that no failover occurred.
    failovers: input.failovers ?? (telemetry?.apiErrorStatus === undefined ? null : 1),
    apiErrorStatus: telemetry?.apiErrorStatus ?? null,
    policyBlocks: input.policyBlocks ?? telemetry?.permissionDenials ?? null,
    clarifications: input.clarifications ?? null,
    verificationFailures: input.verificationFailures ?? 0,
    verified: input.verified,
    findings: input.findings ?? [],
  });
}

const metricNames = ["successRate", "repairs", "costUsd", "cacheHitRate", "wallClockMs", "failovers", "verificationFailures", "policyBlocks", "clarifications"] as const;
type MetricName = typeof metricNames[number];
type Measurements = Record<MetricName, number | null>;
interface ObservedRun { run: CalibrationRun; values: Measurements }
export interface Estimate { value: number | null; n: number }
const contextNames = ["startContextTokens", "contextTokenSum", "cacheReadTokens", "cacheCreationTokens", "turns", "toolLoads", "skillLoads"] as const;
type ContextName = typeof contextNames[number];
export interface ArmSummary { context: Record<ContextName, Estimate>; arm: CalibrationRun["arm"]; sampleSize: number; finished: number; outcomes: number; merged: number; metrics: Record<MetricName, Estimate> }
export interface ConfidenceBin { kind: string; bin: string; n: number; mean: number | null; success: number | null; brier: number | null }
export interface CalibrationReport {
  since: string | null;
  pairedSampleSize: number;
  arms: ArmSummary[];
  pairedDeltas: Record<MetricName, Estimate>;
  confidence: ConfidenceBin[];
  gatewayRoutes: { executionId: string; attempt: number; gateway: SessionGatewayTelemetry }[];
  note: string;
}
const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function estimate(values: (number | null)[]): Estimate { const observed = values.filter((value): value is number => value !== null); return { value: mean(observed), n: observed.length }; }
function total(metrics: RunMetric[], select: (metric: RunMetric) => number | null): number | null {
  if (metrics.length === 0) return null;
  const values = metrics.map(select);
  return values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
function observe(run: CalibrationRun, metrics: RunMetric[]): ObservedRun {
  const complete = run.status === "verified" || run.status === "failed";
  const read = total(metrics, metric => metric.cacheReadTokens);
  const input = total(metrics, metric => metric.inputTokens);
  const creation = total(metrics, metric => metric.cacheCreationTokens);
  const denominator = read !== null && input !== null && creation !== null ? read + input + creation : null;
  return { run, values: {
    successRate: complete ? Number(run.status === "verified") : null,
    repairs: complete ? Math.max(0, metrics.length - 1) : null,
    costUsd: complete ? total(metrics, metric => metric.costUsd) : null,
    cacheHitRate: complete && read !== null && denominator !== null && denominator > 0 ? read / denominator : null,
    wallClockMs: complete ? total(metrics, metric => metric.wallClockMs) : null,
    failovers: complete ? total(metrics, metric => metric.failovers) : null,
    verificationFailures: complete ? total(metrics, metric => metric.verificationFailures) : null,
    policyBlocks: complete ? total(metrics, metric => metric.policyBlocks) : null,
    clarifications: complete ? total(metrics, metric => metric.clarifications) : null,
  } };
}
function mapMetrics<T>(select: (name: MetricName) => T): Record<MetricName, T> {
  return { successRate: select("successRate"), repairs: select("repairs"), costUsd: select("costUsd"), cacheHitRate: select("cacheHitRate"), wallClockMs: select("wallClockMs"), failovers: select("failovers"), verificationFailures: select("verificationFailures"), policyBlocks: select("policyBlocks"), clarifications: select("clarifications") };
}
function contextSummary(runs: ObservedRun[], metrics: RunMetric[]): Record<ContextName, Estimate> {
  const rows = runs.filter(row => row.values.successRate !== null).map(row => {
    const attempts = metrics.filter(metric => metric.executionId === row.run.executionId);
    return {
      startContextTokens: attempts[0]?.startContextTokens ?? null,
      contextTokenSum: total(attempts, metric => metric.contextTokenSum),
      cacheReadTokens: total(attempts, metric => metric.turns?.reduce((sum, turn) => sum + turn.cacheReadTokens, 0) ?? null),
      cacheCreationTokens: total(attempts, metric => metric.turns?.reduce((sum, turn) => sum + turn.cacheCreationTokens, 0) ?? null),
      turns: total(attempts, metric => metric.turns?.length ?? null),
      toolLoads: total(attempts, metric => metric.loadEvents?.filter(event => event.kind === "tool" && event.status === "succeeded").length ?? null),
      skillLoads: total(attempts, metric => metric.loadEvents?.filter(event => event.kind === "skill" && event.status === "succeeded").length ?? null),
    };
  });
  const median = (name: ContextName): Estimate => {
    const values = rows.flatMap(row => row[name] === null ? [] : [row[name]]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return { value: values.length === 0 ? null : values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2, n: values.length };
  };
  return { startContextTokens: median("startContextTokens"), contextTokenSum: median("contextTokenSum"), cacheReadTokens: median("cacheReadTokens"), cacheCreationTokens: median("cacheCreationTokens"), turns: median("turns"), toolLoads: median("toolLoads"), skillLoads: median("skillLoads") };
}
export function buildReport(store: CalibrationStore, since?: string): CalibrationReport {
  const date = since === undefined ? null : new Date(since).toISOString();
  const metrics = store.metrics();
  const outcomes = store.outcomes();
  const runs = store.runs().filter(run => run.purpose !== "skills" && (date === null || run.startedAt >= date));
  const observed = runs.map(run => observe(run, metrics.filter(metric => metric.executionId === run.executionId)));
  const arms = (["jev", "baseline", "fallback"] as const).map(arm => {
    const selected = observed.filter(row => row.run.arm === arm);
    const terminal = outcomes.filter(outcome => selected.some(row => row.run.executionId === outcome.executionId));
    return { arm, sampleSize: selected.length, finished: selected.filter(row => row.values.successRate !== null).length,
      outcomes: terminal.length, merged: terminal.filter(outcome => outcome.status === "merged").length,
      context: contextSummary(selected, metrics), metrics: mapMetrics(name => estimate(selected.map(row => row.values[name]))) };
  });
  const pairs = observed.filter(row => row.run.arm === "jev" && row.run.sampled && row.values.successRate !== null).flatMap(primary => {
    const baseline = observed.find(row => row.run.arm === "baseline" && row.run.pairId === primary.run.pairId && row.run.baseRevision === primary.run.baseRevision && row.values.successRate !== null);
    return baseline ? [{ primary, baseline }] : [];
  });
  const pairedDeltas = mapMetrics(name => estimate(pairs.map(({ primary, baseline }) => {
    const a = primary.values[name]; const b = baseline.values[name];
    return a === null || b === null ? null : a - b;
  })));
  const confidence: ConfidenceBin[] = [];
  for (const kind of ["route", "readiness", "acceptance"]) {
    const values = store.decisions().flatMap(record => {
      const run = runs.find(candidate => candidate.executionId === record.response.executionId && candidate.arm === "jev");
      if (!run || record.response.kind !== kind) return [];
      const outcome = outcomes.find(candidate => candidate.executionId === run.executionId);
      if (!outcome) return [];
      // Intermediate repairs are not the submitted artifact; retain their audit but exclude them here.
      const lastAttempt = metrics.filter(metric => metric.executionId === run.executionId).at(-1);
      if (kind === "acceptance") {
        if (!lastAttempt) return [];
        const identity = lastAttempt.attemptId ? "attemptId" : "attempt";
        if (record.request.inputs.find(input => input.name === identity)?.value !== (lastAttempt.attemptId ?? lastAttempt.attempt)) return [];
      }
      const probability = record.rawAnswer?.type === "noul" ? record.rawAnswer.noul : record.response.confidence;
      return [{ probability, success: Number(outcome.status === "merged") }];
    });
    for (let index = 0; index < 5; index++) {
      const lower = index / 5; const upper = (index + 1) / 5;
      const bin = values.filter(value => value.probability >= lower && (value.probability < upper || index === 4 && value.probability === 1));
      confidence.push({ kind, bin: `${lower.toFixed(1)}–${upper.toFixed(1)}`, n: bin.length, mean: mean(bin.map(value => value.probability)), success: mean(bin.map(value => value.success)), brier: mean(bin.map(value => (value.probability - value.success) ** 2)) });
    }
  }
  const gatewayRoutes = metrics.flatMap(metric => metric.gateway && runs.some(run => run.executionId === metric.executionId)
    ? [{ executionId: metric.executionId, attempt: metric.attempt, gateway: metric.gateway }] : []);
  return { since: date, pairedSampleSize: pairs.length, arms, pairedDeltas, confidence, gatewayRoutes,
    note: pairs.length < 20 ? "Directional: fewer than 20 completed pairs; insufficient evidence to conclude routing wins." : "Compare paired success and cost per successful issue before changing routes." };
}
function fixed(value: number | null): string { return value === null ? "unavailable" : value.toFixed(4); }
function cell(value: Estimate): string { return `${fixed(value.value)} (n=${value.n})`; }
export function formatReport(report: CalibrationReport, options: { context?: boolean } = {}): string {
  const columns = report.arms.filter(arm => arm.arm !== "fallback" || arm.sampleSize > 0);
  return ["Kor calibration report", `Completed Jev/baseline pairs: ${report.pairedSampleSize}`, `Since: ${report.since ?? "all time"}`,
    "Success = identical verification gate in both arms. Terminal merge outcomes are separate.",
    `Metric\t${columns.map(arm => arm.arm === "jev" ? "Jev-route (all)" : arm.arm === "baseline" ? "baseline (sampled)" : arm.arm).join("\t")}\tPaired delta (Jev - baseline)`,
    `Runs (finished/total)\t${columns.map(arm => `${arm.finished}/${arm.sampleSize}`).join("\t")}\t${report.pairedSampleSize} pairs`,
    `Merged/terminal outcomes\t${columns.map(arm => `${arm.merged}/${arm.outcomes}`).join("\t")}\tn/a (baseline never ships)`,
    ...metricNames.map(name => `${name}\t${columns.map(arm => cell(arm.metrics[name])).join("\t")}\t${cell(report.pairedDeltas[name])}`),
    ...(options.context ? ["", "Context medians per completed run (all attempts; start = first attempt)",
      `Metric\t${columns.map(arm => arm.arm).join("\t")}`,
      ...contextNames.map(name => `${name}\t${columns.map(arm => cell(arm.context[name])).join("\t")}`),
      "", "Gateway routing observations (account slots verified by response_trace)",
      "Execution\tAttempt\tDesired account policy\tObserved gateway strategy\tObserved at\tResponse accounts",
      ...report.gatewayRoutes.map(({ executionId, attempt, gateway }) => {
        const accounts = gateway.responses.map(response => response.attribution.kind === "response_trace" ? response.attribution.accountSlot : "unavailable");
        return `${executionId}\t${attempt}\t${gateway.desiredAccountPolicy ?? "unavailable"}\t${gateway.strategy?.value ?? "unavailable"}\t${gateway.strategy?.observedAt ?? "unavailable"}\t${accounts.join(", ") || "unavailable"}`;
      })] : []),
    "", "Confidence calibration against terminal merge success (outcome proxy, not decision-correctness probability)",
    "Kind\tBin\tN\tMean signal\tObserved success\tBrier (proxy)",
    ...report.confidence.filter(row => row.n > 0 || row.bin === "0.0–0.2" && !report.confidence.some(other => other.kind === row.kind && other.n > 0)).map(row => `${row.kind}\t${row.n > 0 ? row.bin : "all"}\t${row.n}\t${fixed(row.mean)}\t${fixed(row.success)}\t${fixed(row.brier)}`),
    "Route uses Choice confidence; readiness/acceptance use Noul probability. Missing outcomes excluded; final acceptance attempt only.", report.note].join("\n");
}
