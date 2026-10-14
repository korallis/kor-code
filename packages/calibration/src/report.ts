import type { Route } from "@kor-code/core";
export interface SessionTelemetryLike {
  permissionDenials: number;
  totalCostUsd?: number;
  durationMs?: number;
  model?: string;
  usage?: Readonly<Record<string, number>>;
  apiErrorStatus?: number;
}
export interface SessionResultLike { telemetry?: SessionTelemetryLike; }
import { metricSchema, type CalibrationRun, type CalibrationStore, type RunMetric, type RunOutcome } from "./store.js";

export interface SessionMetricInput {
  executionId: string;
  attempt: number;
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
    executionId: input.executionId,
    attempt: input.attempt,
    recordedAt: input.finishedAt,
    ...(input.decisionId ? { decisionId: input.decisionId } : {}),
    model: telemetry?.model ?? input.route.model,
    costUsd: telemetry?.totalCostUsd ?? null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
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
export interface ArmSummary { arm: CalibrationRun["arm"]; sampleSize: number; finished: number; outcomes: number; merged: number; metrics: Record<MetricName, Estimate> }
export interface ConfidenceBin { kind: string; bin: string; n: number; mean: number | null; success: number | null; brier: number | null }
export interface CalibrationReport {
  since: string | null;
  pairedSampleSize: number;
  arms: ArmSummary[];
  pairedDeltas: Record<MetricName, Estimate>;
  confidence: ConfidenceBin[];
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
export function buildReport(store: CalibrationStore, since?: string): CalibrationReport {
  const date = since === undefined ? null : new Date(since).toISOString();
  const metrics = store.metrics();
  const outcomes = store.outcomes();
  const runs = store.runs().filter(run => date === null || run.startedAt >= date);
  const observed = runs.map(run => observe(run, metrics.filter(metric => metric.executionId === run.executionId)));
  const arms = (["jev", "baseline", "fallback"] as const).map(arm => {
    const selected = observed.filter(row => row.run.arm === arm);
    const terminal = outcomes.filter(outcome => selected.some(row => row.run.executionId === outcome.executionId));
    return { arm, sampleSize: selected.length, finished: selected.filter(row => row.values.successRate !== null).length,
      outcomes: terminal.length, merged: terminal.filter(outcome => outcome.status === "merged").length,
      metrics: mapMetrics(name => estimate(selected.map(row => row.values[name]))) };
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
      const lastAttempt = Math.max(0, ...metrics.filter(metric => metric.executionId === run.executionId).map(metric => metric.attempt));
      if (kind === "acceptance" && record.request.inputs.find(input => input.name === "attempt")?.value !== lastAttempt) return [];
      const probability = record.rawAnswer?.type === "noul" ? record.rawAnswer.noul : record.response.confidence;
      return [{ probability, success: Number(outcome.status === "merged") }];
    });
    for (let index = 0; index < 5; index++) {
      const lower = index / 5; const upper = (index + 1) / 5;
      const bin = values.filter(value => value.probability >= lower && (value.probability < upper || index === 4 && value.probability === 1));
      confidence.push({ kind, bin: `${lower.toFixed(1)}–${upper.toFixed(1)}`, n: bin.length, mean: mean(bin.map(value => value.probability)), success: mean(bin.map(value => value.success)), brier: mean(bin.map(value => (value.probability - value.success) ** 2)) });
    }
  }
  return { since: date, pairedSampleSize: pairs.length, arms, pairedDeltas, confidence,
    note: pairs.length < 20 ? "Fewer than 20 completed pairs; insufficient evidence to conclude routing wins." : "Compare paired success and cost per successful issue before changing routes." };
}
function fixed(value: number | null): string { return value === null ? "unavailable" : value.toFixed(4); }
function cell(value: Estimate): string { return `${fixed(value.value)} (n=${value.n})`; }
export function formatReport(report: CalibrationReport): string {
  const columns = report.arms.filter(arm => arm.arm !== "fallback" || arm.sampleSize > 0);
  return ["Kor calibration report", `Completed Jev/baseline pairs: ${report.pairedSampleSize}`, `Since: ${report.since ?? "all time"}`,
    "Success = identical verification gate in both arms. Terminal merge outcomes are separate.",
    `Metric\t${columns.map(arm => arm.arm === "jev" ? "Jev-route (all)" : arm.arm === "baseline" ? "baseline (sampled)" : arm.arm).join("\t")}\tPaired delta (Jev - baseline)`,
    `Runs (finished/total)\t${columns.map(arm => `${arm.finished}/${arm.sampleSize}`).join("\t")}\t${report.pairedSampleSize} pairs`,
    `Merged/terminal outcomes\t${columns.map(arm => `${arm.merged}/${arm.outcomes}`).join("\t")}\tn/a (baseline never ships)`,
    ...metricNames.map(name => `${name}\t${columns.map(arm => cell(arm.metrics[name])).join("\t")}\t${cell(report.pairedDeltas[name])}`),
    "", "Confidence calibration against terminal merge success (outcome proxy, not decision-correctness probability)",
    "Kind\tBin\tN\tMean signal\tObserved success\tBrier (proxy)",
    ...report.confidence.filter(row => row.n > 0 || row.bin === "0.0–0.2" && !report.confidence.some(other => other.kind === row.kind && other.n > 0)).map(row => `${row.kind}\t${row.n > 0 ? row.bin : "all"}\t${row.n}\t${fixed(row.mean)}\t${fixed(row.success)}\t${fixed(row.brier)}`),
    "Route uses Choice confidence; readiness/acceptance use Noul probability. Missing outcomes excluded; final acceptance attempt only.", report.note].join("\n");
}
