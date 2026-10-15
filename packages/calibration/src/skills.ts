import { DEFAULT_SKILL_THRESHOLDS, MIN_SKILL_SAMPLES, type SkillLearning } from "@kor-code/jev";
import type { CalibrationStore, RunMetric } from "./store.js";

const WINDOW_DAYS = 30;
const MIN_RECENT_OFFERS = 10;
const DAY_MS = 86_400_000;
const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const complete = (status: string): boolean => status === "verified" || status === "failed";
const sumCost = (metrics: RunMetric[]): number | null => metrics.length && metrics.every(metric => metric.costUsd !== null)
  ? metrics.reduce((sum, metric) => sum + (metric.costUsd ?? 0), 0) : null;

export interface SkillReliabilityBin {
  lower: number; upper: number; n: number; mean: number | null; success: number | null; brier: number | null;
}
export interface SkillStats extends SkillLearning {
  name: string;
  hash: string | null;
  recentOffers: number;
  loadObservations: number;
  pairs: number;
  costDeltaUsd: number | null;
  terminal: number;
  merged: number;
  overrides: number;
  /** How far Jev's offer probability ran ahead of merge outcomes; it raises every tier threshold once samples suffice. */
  overconfidence: number;
  reliability: SkillReliabilityBin[];
}
export interface SkillsReport { since: string | null; minimumSamples: number; windowDays: number; skills: SkillStats[]; note: string }
/** One change outcome learning makes to Jev's skill selection, and why. */
export interface SkillLearningChange { skill: string; kind: "hidden" | "stricter"; reason: string }

export function buildSkillsReport(store: CalibrationStore, options: { since?: string; now?: string; excludeExecutionId?: string } = {}): SkillsReport {
  const since = options.since === undefined ? null : new Date(options.since).toISOString();
  const now = Date.parse(options.now ?? new Date().toISOString());
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const runs = store.runs();
  const metrics = store.metrics();
  const outcomes = store.outcomes();
  const groups = new Map<string, { name: string; hash: string | null; offers: {
    executionId: string; probability: number; loaded: boolean; used: boolean; observed: boolean; recordedAt: string; override: boolean;
  }[] }>();
  const runById = new Map(runs.map(run => [run.executionId, run]));
  const metricsByExecution = new Map<string, RunMetric[]>();
  const metricsByDecision = new Map<string, RunMetric[]>();
  for (const metric of metrics) {
    const execution = metricsByExecution.get(metric.executionId) ?? [];
    execution.push(metric);
    metricsByExecution.set(metric.executionId, execution);
    if (metric.skillDecisionId) {
      const decision = metricsByDecision.get(metric.skillDecisionId) ?? [];
      decision.push(metric);
      metricsByDecision.set(metric.skillDecisionId, decision);
    }
  }
  for (const record of store.decisions("skills")) {
    const decision = record.response;
    const run = runById.get(decision.executionId);
    if (decision.kind !== "skills" || !decision.plan || decision.plan.source !== "jev" || !run || run.arm === "baseline" || run.executionId === options.excludeExecutionId || (since !== null && run.startedAt < since)) continue;
    const attempts = (metricsByDecision.get(decision.decisionId) ?? []).filter(metric => metric.executionId === run.executionId);
    if (!attempts.length) continue;
    for (const skill of decision.plan.skills.filter(skill => skill.tier !== "hidden")) {
      const key = JSON.stringify([skill.name, skill.hash ?? null]);
      let group = groups.get(key);
      if (!group) { group = { name: skill.name, hash: skill.hash ?? null, offers: [] }; groups.set(key, group); }
      const used = attempts.some(metric => metric.loadEvents?.some(event => event.kind === "skill" && event.status === "succeeded" && (event.name === `kor-skills:${skill.name}` || event.name === skill.name)));
      group.offers.push({ executionId: run.executionId, probability: skill.probability, used, loaded: skill.tier === "pinned" || used,
        observed: skill.tier === "pinned" || attempts.every(metric => metric.loadEvents !== null), recordedAt: record.recordedAt,
        override: record.overrides !== undefined || decision.overrides !== undefined });
    }
  }
  const skills = [...groups.values()].map(({ name, hash, offers }): SkillStats => {
    const executions = [...new Set(offers.map(offer => offer.executionId))];
    const completed = executions.filter(id => complete(runById.get(id)?.status ?? ""));
    const recent = executions.filter(id => offers.some(offer => offer.executionId === id && Date.parse(offer.recordedAt) >= windowStart && Date.parse(offer.recordedAt) <= now && offer.observed) && offers.filter(offer => offer.executionId === id).every(offer => offer.observed) && completed.includes(id));
    const terminal = outcomes.filter(outcome => completed.includes(outcome.executionId));
    const reliability = Array.from({ length: 5 }, (_, index): SkillReliabilityBin => {
      const lower = index / 5, upper = (index + 1) / 5;
      const values = terminal.flatMap(outcome => {
        const offer = offers.filter(offer => offer.executionId === outcome.executionId).at(-1);
        return offer && offer.probability >= lower && (offer.probability < upper || index === 4 && offer.probability === 1)
          ? [{ probability: offer.probability, success: Number(outcome.status === "merged") }] : [];
      });
      return { lower, upper, n: values.length, mean: mean(values.map(value => value.probability)), success: mean(values.map(value => value.success)), brier: mean(values.map(value => (value.probability - value.success) ** 2)) };
    });
    const pairs = completed.flatMap(id => {
      const primary = runById.get(id)!;
      const baseline = runs.find(run => run.purpose === "skills" && run.arm === "baseline" && run.pairId === `${primary.pairId}-skills` && run.baseRevision === primary.baseRevision && complete(run.status));
      if (!baseline || JSON.stringify(baseline.route) !== JSON.stringify(primary.route)) return [];
      const a = (metricsByExecution.get(id) ?? []), b = (metricsByExecution.get(baseline.executionId) ?? []);
      if (!a.length || !b.length || b.some((metric, index) => metric.tools === null || JSON.stringify(metric.tools) !== JSON.stringify((a[index] ?? a.at(-1))?.tools))) return [];
      const aCost = sumCost(a), bCost = sumCost(b);
      return [{ lift: Number(a.at(-1)?.verified ?? false) - Number(b.at(-1)?.verified ?? false), cost: aCost === null || bCost === null ? null : aCost - bCost }];
    });
    const passed = (id: string): number => Number((metricsByExecution.get(id) ?? []).at(-1)?.verified ?? false);
    const samples = completed.length;
    const thresholds = { ...DEFAULT_SKILL_THRESHOLDS };
    // Merge success is an outcome proxy: only penalise overconfidence, never relax a tier.
    const penalty = Math.max(0, ...reliability.filter(bin => bin.n >= MIN_SKILL_SAMPLES).map(bin => (bin.mean ?? 0) - (bin.success ?? 0)));
    if (samples >= MIN_SKILL_SAMPLES) {
      thresholds.pinned = Math.min(1, thresholds.pinned + penalty);
      thresholds.listed = Math.min(1, thresholds.listed + penalty);
      thresholds.armed = Math.min(1, thresholds.armed + penalty);
    }
    return { name, hash, samples, offered: executions.length,
      loaded: executions.filter(id => offers.some(offer => offer.executionId === id && offer.loaded)).length,
      used: executions.filter(id => offers.some(offer => offer.executionId === id && offer.used)).length,
      loadObservations: executions.filter(id => offers.some(offer => offer.executionId === id && offer.observed)).length,
      passRate: mean(completed.map(passed)),
      lift: mean(pairs.map(pair => pair.lift)), pairs: pairs.length, costDeltaUsd: mean(pairs.flatMap(pair => pair.cost === null ? [] : [pair.cost])),
      terminal: terminal.length, merged: terminal.filter(outcome => outcome.status === "merged").length,
      overrides: executions.filter(id => offers.some(offer => offer.executionId === id && offer.override)).length,
      overconfidence: penalty,
      recentOffers: recent.length,
      demoted: samples >= MIN_SKILL_SAMPLES && recent.length >= MIN_RECENT_OFFERS && !offers.some(offer => recent.includes(offer.executionId) && offer.loaded),
      thresholds, reliability };
  }).sort((a, b) => a.name.localeCompare(b.name) || (a.hash ?? "").localeCompare(b.hash ?? ""));
  return { since, minimumSamples: MIN_SKILL_SAMPLES, windowDays: WINDOW_DAYS, skills,
    note: "Below 20 completed samples per skill version, statistics are display-only. Lift below 20 completed same-route no-skills pairs is directional. Reliability uses terminal merge success as an outcome proxy, not proof of skill correctness. Policy and budgets never learn." };
}

const applies = (stats: SkillStats, catalogue: readonly { name: string; hash?: string | undefined }[]): boolean =>
  stats.samples >= MIN_SKILL_SAMPLES && catalogue.some(skill => skill.name === stats.name && skill.hash === stats.hash);

/** The learning the next session applies: skill versions still in the catalogue with enough completed samples. */
export function appliedSkillLearning(report: SkillsReport, catalogue: readonly { name: string; hash?: string | undefined }[]): Record<string, SkillLearning> {
  return Object.fromEntries(report.skills.filter(stats => applies(stats, catalogue)).map(stats => [stats.name, {
    samples: stats.samples, offered: stats.offered, loaded: stats.loaded, used: stats.used, passRate: stats.passRate,
    lift: stats.pairs >= MIN_SKILL_SAMPLES ? stats.lift : null, demoted: stats.demoted, thresholds: stats.thresholds,
  }]));
}

/** What that learning changes in Jev's skill selection, and why, in the words Mission Control shows. */
export function skillLearningChanges(report: SkillsReport, catalogue: readonly { name: string; hash?: string | undefined }[]): SkillLearningChange[] {
  const value = (number: number): string => number.toFixed(2);
  return report.skills.filter(stats => applies(stats, catalogue)).flatMap((stats): SkillLearningChange[] => {
    return [
      ...(stats.demoted ? [{ skill: stats.name, kind: "hidden" as const, reason: `Offered in ${stats.recentOffers} finished sessions in the last ${WINDOW_DAYS} days and never loaded, so Jev stops offering it unless a repository pins it.` }] : []),
      ...(stats.overconfidence > 0 ? [{ skill: stats.name, kind: "stricter" as const, reason: `Jev's confidence ran ${value(stats.overconfidence)} ahead of merge outcomes over ${stats.samples} completed runs, so it now pins at ${value(stats.thresholds.pinned)}, lists at ${value(stats.thresholds.listed)} and arms at ${value(stats.thresholds.armed)} (defaults ${value(DEFAULT_SKILL_THRESHOLDS.pinned)}, ${value(DEFAULT_SKILL_THRESHOLDS.listed)}, ${value(DEFAULT_SKILL_THRESHOLDS.armed)}).` }] : []),
    ];
  });
}

export function formatSkillsReport(report: SkillsReport): string {
  const value = (number: number | null): string => number === null ? "unavailable" : number.toFixed(4);
  return ["Kor skills outcome report", `Since: ${report.since ?? "all time"}`,
    "Skill\tVersion\tSamples\tOffered\tLoaded\tUsed\tPass rate\tPairs\tLift\tCost delta USD\tRecent offers\tStatus\tThresholds (pin/list/arm)",
    ...report.skills.map(skill => `${skill.name}\t${skill.hash?.slice(0, 16) ?? "legacy"}\t${skill.samples}\t${skill.offered}\t${skill.loaded}\t${skill.used}\t${value(skill.passRate)}\t${skill.pairs}\t${value(skill.lift)}\t${value(skill.costDeltaUsd)}\t${skill.recentOffers}\t${skill.demoted ? "demoted" : skill.samples < report.minimumSamples ? "display-only" : "learning"}\t${Object.values(skill.thresholds).map(value).join("/")}`),
    "", "Reliability against terminal merge outcomes", "Skill\tBin\tN\tMean probability\tMerge rate\tBrier (proxy)",
    ...report.skills.flatMap(skill => skill.reliability.filter(bin => bin.n).map(bin => `${skill.name}\t${bin.lower.toFixed(1)}–${bin.upper.toFixed(1)}\t${bin.n}\t${value(bin.mean)}\t${value(bin.success)}\t${value(bin.brier)}`)), report.note].join("\n");
}
