// Screen 6: what Jev decided, how it turned out and what it learned. Every
// figure comes from the decision audit and the calibration store.
import * as stylex from '@stylexjs/stylex';
import { BrainCircuit, Coins, FlaskConical, History, Layers, Lightbulb, ShieldCheck, Sparkles, Square, Target, TrendingUp, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import type { CalibrationReport } from '@kor-code/calibration';
import type { DecisionRecord } from '@kor-code/core';
import { ApiFailure } from '../api/client';
import { useMissionRuns, useOverrides } from '../api/data';
import { useBrain, useConfig, useSaveConfig } from '../api/queries';
import { href } from '../router';
import { AppFrame } from '../shell/AppFrame';
import { openAsk } from '../shell/askStore';
import { color, font, fontSize, space, tint, tracking } from '../theme/tokens.stylex';
import { animate, delayBy } from '../theme/animate';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Bar } from '../ui/charts';
import { Segmented, TextInput } from '../ui/form';
import { Icon } from '../ui/icon';
import { Empty, Notice } from '../ui/misc';
import { JevOrb } from '../ui/orb';
import { Pill, ProvenanceChip } from '../ui/pill';
import { Table, Td, Th, Tr } from '../ui/table';
import { layout } from '../ui/layout';
import { text, type Tone } from '../ui/text';
import { count, pct, prob, usd } from '../lib/format';
import { learnedSummary, learningStatus, type LearningStatus } from '../lib/learning';
import { keyOf } from '../lib/runs';
import { clock, shortDate, useNow } from '../lib/time';
import { page, QueryError } from './shared';

const NARROW = '@media (max-width: 1499px)';

const styles = stylex.create({
  head: { display: 'flex', alignItems: 'center', gap: space.s4, flexWrap: 'wrap' },
  kpis: { display: 'grid', gridTemplateColumns: { default: 'repeat(5, minmax(0, 1fr))', [NARROW]: 'repeat(3, minmax(0, 1fr))' }, gap: space.s4 },
  kpi: { paddingBlock: space.s3h, paddingInline: space.s4, display: 'flex', flexDirection: 'column', gap: space.s2, minHeight: '108px' },
  kpiLabel: { display: 'flex', alignItems: 'center', gap: '7px', fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: tracking.chip, textTransform: 'uppercase', color: color.textMuted },
  kpiValue: { fontFamily: font.display, fontSize: fontSize.figureLg, fontWeight: 600, lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: space.s2 },
  kpiSmall: { fontFamily: font.sans, fontSize: fontSize.sm, fontWeight: 400, color: color.textMuted },
  kpiFoot: { fontSize: fontSize.xsPlus, color: color.textMuted },
  row2: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr)', [NARROW]: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: space.s4 },
  row3: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1.45fr) minmax(0, 1.05fr) minmax(0, 0.95fr)', [NARROW]: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: space.s4 },
  span2: { gridColumn: { default: null, [NARROW]: '1 / -1' } },
  chart: { width: '100%', height: '190px', display: 'block' },
  axis: { fill: color.textFaint, fontFamily: font.mono, fontSize: fontSize.nano },
  grid: { stroke: color.hairline, strokeWidth: 1 },
  diag: { stroke: color.textMuted, strokeDasharray: '3 3', strokeWidth: 1, fill: 'none' },
  barFill: { fill: 'url(#kor-cal)' },
  stopA: { stopColor: color.cyan }, stopB: { stopColor: color.violetDeep },
  barLabel: { fill: color.textMuted, fontFamily: font.mono, fontSize: fontSize.nano },
  legend: { display: 'flex', gap: space.s4, fontSize: fontSize.xsPlus, color: color.textSecondary, marginTop: space.s2, flexWrap: 'wrap' },
  legendCyan: { backgroundColor: color.cyan },
  legendSwatch: { width: '14px', height: '3px', borderRadius: '2px', display: 'inline-block', marginRight: space.s1h, verticalAlign: 'middle' },
  arm: { display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: space.s2h, alignItems: 'center', paddingBlock: space.s2, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, fontSize: fontSize.smPlus },
  armHead: { fontFamily: font.mono, fontSize: fontSize.nano, letterSpacing: tracking.label, textTransform: 'uppercase', color: color.textFaint },
  armVal: { fontFamily: font.mono, fontSize: fontSize.sm },
  agree: { display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) 34px 38px', gap: space.s2h, alignItems: 'center', paddingBlock: '5px', fontFamily: font.mono, fontSize: fontSize.xsPlus, color: color.textSecondary },
  learning: { display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr)', gap: space.s3, paddingBlock: space.s3, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine },
  learnIcon: { width: '26px', height: '26px', borderRadius: '8px', display: 'grid', placeItems: 'center', backgroundColor: color.greenDim, color: color.green, borderWidth: '1px', borderStyle: 'solid', borderColor: tint.greenEdge },
  learnText: { fontSize: fontSize.base, color: color.text, lineHeight: 1.45, fontWeight: 500 },
  experiment: { paddingBlock: space.s4h, paddingInline: space.s4h, display: 'flex', flexDirection: 'column', gap: space.s3 },
  expTitle: { fontFamily: font.display, fontSize: fontSize.xl, fontWeight: 600, lineHeight: 1.25 },
  expTiles: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.s2h },
  expTile: { paddingBlock: space.s3, paddingInline: space.s3h, borderRadius: '11px', borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, backgroundColor: tint.ghost },
  expValue: { fontFamily: font.display, fontSize: fontSize.figure, fontWeight: 600 },
  next: { paddingBlock: space.s3, paddingInline: space.s3h, borderRadius: '12px', borderWidth: '1px', borderStyle: 'dashed', borderColor: tint.violetEdgeStrong, fontSize: fontSize.smPlus, color: color.textSecondary, lineHeight: 1.5 },
  rateInput: { width: '120px' },
  tableWrap: { paddingInline: space.s2, overflowX: 'auto' },
  skillRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 44px 52px', gap: space.s2h, alignItems: 'center', paddingBlock: '5px', fontFamily: font.mono, fontSize: fontSize.xsPlus, color: color.textSecondary },
});

const STATUS_TONE: Record<LearningStatus, Tone | 'ghost'> = { hidden: 'rose', stricter: 'amber', learning: 'green', measuring: 'cyan', 'old version': 'ghost' };

const RANGES = { '7': 7, '30': 30, '90': 90 } as const;
type Range = keyof typeof RANGES;

/** Expected calibration error over the report's confidence bins. */
function ece(report: CalibrationReport | null): number | null {
  const bins = (report?.confidence ?? []).filter(bin => bin.n > 0 && bin.mean !== null && bin.success !== null);
  const n = bins.reduce((sum, bin) => sum + bin.n, 0);
  if (!n) return null;
  return bins.reduce((sum, bin) => sum + bin.n * Math.abs((bin.mean ?? 0) - (bin.success ?? 0)), 0) / n;
}

function CalibrationChart({ report }: { report: CalibrationReport | null }) {
  const byBin = new Map<string, { n: number; success: number; mean: number }>();
  for (const bin of report?.confidence ?? []) {
    if (bin.n === 0 || bin.success === null || bin.mean === null) continue;
    const entry = byBin.get(bin.bin) ?? { n: 0, success: 0, mean: 0 };
    entry.success = (entry.success * entry.n + bin.success * bin.n) / (entry.n + bin.n);
    entry.mean = (entry.mean * entry.n + bin.mean * bin.n) / (entry.n + bin.n);
    entry.n += bin.n;
    byBin.set(bin.bin, entry);
  }
  const bins = [...byBin].sort((a, b) => a[0].localeCompare(b[0]));
  if (bins.length === 0) return <Empty title="No finished runs with confidence yet.">Calibration needs decisions whose runs have finished.</Empty>;
  const W = 340, H = 170, left = 26, bottom = 22, top = 8;
  const y = (value: number) => top + (1 - value) * (H - top - bottom);
  const step = (W - left) / bins.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} {...stylex.props(styles.chart)} role="img" aria-label="Calibration: observed success by confidence bucket">
      <defs><linearGradient id="kor-cal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" {...stylex.props(styles.stopA)} /><stop offset="1" {...stylex.props(styles.stopB)} /></linearGradient></defs>
      {[0, 0.25, 0.5, 0.75, 1].map(v => <g key={v}><line x1={left} x2={W} y1={y(v)} y2={y(v)} {...stylex.props(styles.grid)} /><text x={2} y={y(v) + 3} {...stylex.props(styles.axis)}>{v.toFixed(2)}</text></g>)}
      <path d={`M${left},${y(0)} L${W},${y(1)}`} {...stylex.props(styles.diag)} />
      {bins.map(([name, bin], index) => {
        const x = left + index * step + step * 0.22, w = step * 0.56;
        return (
          <g key={name} {...stylex.props(animate.fadeIn, delayBy.ms(index * 60))}>
            <rect x={x} y={y(bin.success)} width={w} height={Math.max(1, y(0) - y(bin.success))} rx="4" {...stylex.props(styles.barFill)} />
            <text x={x + w / 2} y={y(bin.success) - 4} textAnchor="middle" {...stylex.props(styles.barLabel)}>n {bin.n}</text>
            <text x={x + w / 2} y={H - 6} textAnchor="middle" {...stylex.props(styles.axis)}>{name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function outcome(decision: DecisionRecord, runs: ReturnType<typeof useMissionRuns>['runs'], overridden: Set<string>): { label: string; tone: Tone } {
  if (overridden.has(decision.decisionId)) return { label: 'overridden', tone: 'magenta' };
  const run = runs.find(one => one.executionId === decision.executionId);
  if (!run) return { label: '—', tone: 'slate' };
  if (run.status === 'complete') return { label: run.pullRequestUrl ? 'merged' : 'complete', tone: 'green' };
  if (run.status === 'review') return { label: 'PR open', tone: 'violet' };
  if (run.status === 'waiting') return { label: 'ship?', tone: 'magenta' };
  if (run.status === 'failed') return { label: 'failed', tone: 'rose' };
  if (run.status === 'blocked' || run.status === 'escalated') return { label: run.needsInput ? 'needs input' : run.status, tone: 'amber' };
  if (run.status === 'canceled') return { label: 'canceled', tone: 'slate' };
  return { label: run.status, tone: 'cyan' };
}

export function JevBrain() {
  const now = useNow();
  const brain = useBrain();
  const config = useConfig();
  const save = useSaveConfig();
  const { runs } = useMissionRuns();
  const overrides = useOverrides();
  const [range, setRange] = useState<Range>('30');
  const [rate, setRate] = useState<string | null>(null);
  const since = now - RANGES[range] * 86_400_000;
  const decisions = (brain.data?.decisions.value ?? []).filter(decision => Date.parse(decision.recordedAt) >= since).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const report = brain.data?.calibration.value ?? null;
  const kinds = new Set(decisions.map(decision => decision.kind));
  const runIds = new Set(decisions.filter(decision => runs.some(run => run.executionId === decision.executionId)).map(decision => decision.executionId));
  const escalatedShare = decisions.length ? decisions.filter(decision => decision.escalated).length / decisions.length : null;
  const arm = (name: 'jev' | 'baseline' | 'fallback') => report?.arms.find(one => one.arm === name);
  const jev = arm('jev'), baseline = arm('baseline');
  const jevSuccess = jev?.metrics.successRate.value ?? null, baseSuccess = baseline?.metrics.successRate.value ?? null;
  const jevCost = jev?.metrics.costUsd.value ?? null, baseCost = baseline?.metrics.costUsd.value ?? null;
  const error = ece(report);
  const recentOverrides = overrides.filter(record => Date.parse(record.recordedAt) >= since);
  const overridden = new Set(overrides.filter(record => record.status === 'applied').map(record => record.target));
  const agreement = [...new Set((report?.confidence ?? []).map(bin => bin.kind))].map(kind => {
    const bins = (report?.confidence ?? []).filter(bin => bin.kind === kind && bin.success !== null && bin.n > 0);
    const n = bins.reduce((sum, bin) => sum + bin.n, 0);
    return { kind, n, rate: n ? bins.reduce((sum, bin) => sum + (bin.success ?? 0) * bin.n, 0) / n : null };
  }).filter(entry => entry.n > 0).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const sampleRate = config.data?.config.calibration.sampleRate ?? null;
  const setSampleRate = (value: number) => { if (config.data) save.mutate({ ...config.data.config, calibration: { ...config.data.config.calibration, sampleRate: value } }, { onSuccess: () => setRate(null) }); };
  const learned = brain.data?.learnings;
  const learnings = learned?.value.changes ?? [];
  const actionError = save.error;
  return (
    <AppFrame active="brain" crumbs={['Jev', 'Brain']} askHint={'Ask Jev — "what did you learn about a project?", "why do some runs fail on retry?"'}>
      <div {...stylex.props(page.page)}>
        <header {...stylex.props(styles.head)}>
          <JevOrb size={52} />
          <div>
            <h1 {...stylex.props(page.title)}>Jev Brain</h1>
            <p {...stylex.props(page.lede)}>What Jev decided, how it turned out, and what it learned. Every figure comes from the decision audit and the calibration store.</p>
          </div>
          <span {...stylex.props(layout.grow)} />
          <Segmented label="Range" value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
          {brain.data && <ProvenanceChip provenance={brain.data.decisions.provenance} reason={brain.data.decisions.reason}>{brain.data.decisions.provenance} · audit {brain.data.decisions.observedAt ? clock(brain.data.decisions.observedAt) : ''}</ProvenanceChip>}
        </header>
        {brain.error && <QueryError error={brain.error} what="Jev's audit" />}
        {actionError && <Notice title={actionError.message} hint={actionError instanceof ApiFailure ? actionError.hint : undefined} />}
        <section {...stylex.props(styles.kpis)}>
          <Card index={0} variant="neon" style={styles.kpi}>
            <div {...stylex.props(styles.kpiLabel)}><Icon icon={BrainCircuit} size={13} style={text.violet} />Decisions</div>
            <div {...stylex.props(styles.kpiValue, text.grad)}>{count(decisions.length)}</div>
            <div {...stylex.props(styles.kpiFoot)}>{kinds.size} kinds · <span {...stylex.props(text.green)}>{runIds.size} runs</span> · {escalatedShare === null ? '—' : pct(escalatedShare, 1)} escalated</div>
          </Card>
          <Card index={1} style={styles.kpi}>
            <div {...stylex.props(styles.kpiLabel)}><Icon icon={ShieldCheck} size={13} style={text.green} />Verified first pass</div>
            <div {...stylex.props(styles.kpiValue)}>{pct(jevSuccess)}<span {...stylex.props(styles.kpiSmall)}>Jev routes</span></div>
            <div {...stylex.props(styles.kpiFoot)}>baseline route {pct(baseSuccess)}{jevSuccess !== null && baseSuccess !== null && <> · <span {...stylex.props(jevSuccess >= baseSuccess ? text.green : text.rose)}>{jevSuccess >= baseSuccess ? '+' : ''}{Math.round((jevSuccess - baseSuccess) * 100)} pts</span></>}</div>
          </Card>
          <Card index={2} style={styles.kpi}>
            <div {...stylex.props(styles.kpiLabel)}><Icon icon={Target} size={13} style={text.cyan} />Calibration error</div>
            <div {...stylex.props(styles.kpiValue)}>{error === null ? '—' : error.toFixed(2)}<span {...stylex.props(styles.kpiSmall)}>ECE</span></div>
            <div {...stylex.props(styles.kpiFoot)}>{error === null ? 'needs finished runs' : error < 0.1 ? 'confidence matches outcomes' : 'confidence drifts from outcomes'}</div>
          </Card>
          <Card index={3} style={styles.kpi}>
            <div {...stylex.props(styles.kpiLabel)}><Icon icon={Coins} size={13} style={text.amber} />Cost per verified run</div>
            <div {...stylex.props(styles.kpiValue)}>{usd(jevCost)}<span {...stylex.props(styles.kpiSmall)}>mean</span></div>
            <div {...stylex.props(styles.kpiFoot)}>baseline {usd(baseCost)}{jevCost !== null && baseCost ? <> · <span {...stylex.props(jevCost <= baseCost ? text.green : text.rose)}>{Math.round(((jevCost - baseCost) / baseCost) * 100)}%</span></> : null}</div>
          </Card>
          <Card index={4} style={styles.kpi}>
            <div {...stylex.props(styles.kpiLabel)}><Icon icon={WandSparkles} size={13} style={text.magenta} />Your overrides</div>
            <div {...stylex.props(styles.kpiValue)}>{recentOverrides.length}<span {...stylex.props(styles.kpiSmall)}>{recentOverrides.filter(r => r.status === 'applied').length} applied · {recentOverrides.filter(r => r.status === 'rejected').length} refused</span></div>
            <div {...stylex.props(styles.kpiFoot)}>{recentOverrides.filter(r => r.status === 'reverted').length} reverted</div>
          </Card>
        </section>
        <section {...stylex.props(styles.row2)}>
          <Card index={5}>
            <CardHeader icon={Target} title="Calibration" aside={<span {...stylex.props(text.mono, text.xs, text.muted)}>all kinds · {report?.since ? `since ${shortDate(report.since)}` : 'all time'}</span>} />
            <CardBody>
              <CalibrationChart report={report} />
              <div {...stylex.props(styles.legend)}><span><i {...stylex.props(styles.legendSwatch, styles.legendCyan)} />observed success</span><span {...stylex.props(text.muted)}>- - perfect calibration</span></div>
            </CardBody>
          </Card>
          <Card index={6}>
            <CardHeader icon={TrendingUp} title="Jev against the baseline" aside={<span {...stylex.props(text.mono, text.xs, text.muted)}>paired runs · {report?.pairedSampleSize ?? 0} pairs</span>} />
            <CardBody>
              <div {...stylex.props(styles.arm, styles.armHead)}><span>arm</span><span>verified</span><span>cost / run</span><span>cache hit</span></div>
              {(report?.arms ?? []).map(entry => (
                <div key={entry.arm} {...stylex.props(styles.arm)}>
                  <span><b {...stylex.props(text.strong)}>{entry.arm}</b> <span {...stylex.props(text.mono, text.xs, text.muted)}>n {entry.finished}</span></span>
                  <span {...stylex.props(layout.row)}><Bar pct={(entry.metrics.successRate.value ?? 0) * 100} tone={entry.arm === 'jev' ? 'brand' : 'amber'} size="thin" /><span {...stylex.props(styles.armVal)}>{pct(entry.metrics.successRate.value)}</span></span>
                  <span {...stylex.props(styles.armVal)}>{usd(entry.metrics.costUsd.value)}</span>
                  <span {...stylex.props(styles.armVal)}>{pct(entry.metrics.cacheHitRate.value)}</span>
                </div>
              ))}
              {(report?.arms.length ?? 0) === 0 && <Empty title="No calibration runs yet." />}
              {report?.note && <p {...stylex.props(text.muted, text.sm, layout.mt3)}>{report.note}</p>}
            </CardBody>
          </Card>
          <Card index={7} style={styles.span2}>
            <CardHeader icon={Layers} title="Agreement with outcome" />
            <CardBody>
              {agreement.map(entry => (
                <div key={entry.kind} {...stylex.props(styles.agree)}>
                  <span>{entry.kind}</span>
                  <Bar pct={(entry.rate ?? 0) * 100} tone={(entry.rate ?? 0) < 0.75 ? 'amber' : 'brand'} size="thin" />
                  <span {...stylex.props(text.faint)}>{entry.n}</span>
                  <span {...stylex.props(text.right)}>{pct(entry.rate)}</span>
                </div>
              ))}
              {agreement.length === 0 && <Empty title="No finished decisions to compare yet." />}
            </CardBody>
          </Card>
        </section>
        <section {...stylex.props(styles.row3)}>
          <Card index={8} clip style={styles.span2}>
            <CardHeader icon={History} title="Recent decisions" aside={<a href={href('agents')} {...stylex.props(text.violet, text.sm)}>Runs →</a>} />
            <div {...stylex.props(styles.tableWrap)}>
              <Table label="Recent decisions">
                <thead><tr><Th>When</Th><Th>Issue</Th><Th>Kind</Th><Th>Choice</Th><Th align="right">Conf.</Th><Th>Outcome</Th></tr></thead>
                <tbody>
                  {decisions.slice(0, 10).map(decision => {
                    const run = runs.find(one => one.executionId === decision.executionId);
                    const result = outcome(decision, runs, overridden);
                    return (
                      <Tr key={decision.decisionId}>
                        <Td><span {...stylex.props(text.mono, text.muted)}>{now - Date.parse(decision.recordedAt) < 86_400_000 ? clock(decision.recordedAt) : shortDate(decision.recordedAt).split(' ')[0]}</span></Td>
                        <Td>{run ? <a href={href('linear', run.executionId)} {...stylex.props(text.key)}>{keyOf(run)}</a> : <span {...stylex.props(text.mono, text.faint)}>{decision.executionId.slice(0, 8)}</span>}</Td>
                        <Td><span {...stylex.props(text.mono, text.secondary)}>{decision.kind}</span></Td>
                        <Td><span {...stylex.props(text.ellipsis)}>{decision.choice}</span></Td>
                        <Td align="right"><span {...stylex.props(text.mono, decision.confidence < 0.7 ? text.amber : text.secondary)}>{prob(decision.confidence)}</span></Td>
                        <Td><Pill tone={result.tone} small>{result.label}</Pill></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              {decisions.length === 0 && <Empty title="No decisions in this range." />}
            </div>
          </Card>
          <Card index={9}>
            <CardHeader icon={Lightbulb} title="Learnings" count={learnings.length} aside={brain.data && <ProvenanceChip provenance={brain.data.learnings.provenance} reason={brain.data.learnings.reason} />} />
            <CardBody>
              {learnings.map(change => (
                <div key={`${change.skill}-${change.kind}`} {...stylex.props(styles.learning)}>
                  <span {...stylex.props(styles.learnIcon)}><Icon icon={Lightbulb} size={14} /></span>
                  <div>
                    <div {...stylex.props(layout.row)}><b {...stylex.props(text.mono, text.strong)}>{change.skill}</b><Pill tone={STATUS_TONE[change.kind]} small>{change.kind}</Pill></div>
                    <div {...stylex.props(styles.learnText, layout.mt2)}>{change.reason}</div>
                    <div {...stylex.props(layout.row, layout.mt2)}><Button size="sm" variant="violet" icon={Sparkles} onClick={() => openAsk({ prompt: `Explain why you changed how you pick the ${change.skill} skill: "${change.reason}"` })}>Ask Jev why</Button></div>
                  </div>
                </div>
              ))}
              {learned?.provenance === 'unavailable' && <Empty title="Learnings unavailable.">{learned.reason ?? 'Not reported by the daemon.'}</Empty>}
              {learned?.provenance === 'live' && learnings.length === 0 && <p {...stylex.props(text.secondary, text.sm, layout.mt2)}>{learnedSummary(learned.value)}</p>}
              {learned && learned.value.skills.length > 0 && (
                <div {...stylex.props(layout.mt3)}>
                  <div {...stylex.props(styles.skillRow, styles.armHead)}><span>skill</span><span>status</span><span>runs</span><span>loaded</span></div>
                  {learned.value.skills.map(skill => {
                    const status = learningStatus(skill, learned.value);
                    return (
                      <div key={`${skill.name}-${skill.hash ?? 'legacy'}`} {...stylex.props(styles.skillRow)} title={`offered ${skill.offered} · loaded ${skill.loaded} · used ${skill.used} · pass rate ${pct(skill.passRate)} · lift ${skill.lift === null ? '—' : prob(skill.lift)}`}>
                        <span {...stylex.props(text.ellipsis, !skill.current && text.faint)}>{skill.name}</span>
                        <Pill tone={STATUS_TONE[status]} small>{status}</Pill>
                        <span>{skill.samples}/{learned.value.minimumSamples}</span>
                        <span>{skill.loaded}/{skill.offered}</span>
                      </div>
                    );
                  })}
                  <p {...stylex.props(text.muted, text.xs, layout.mt2)}>{learned.value.note}</p>
                </div>
              )}
            </CardBody>
          </Card>
          <Card index={10} variant="neon" style={styles.experiment}>
            <div {...stylex.props(layout.row)}><Icon icon={FlaskConical} size={15} style={text.cyan} /><span {...stylex.props(text.eyebrow, text.cyan)}>{sampleRate ? 'Running experiment' : 'Experiment stopped'}</span></div>
            <div {...stylex.props(styles.expTitle)}>Jev's route against the baseline route</div>
            <p {...stylex.props(text.secondary, text.base)}>{sampleRate ? <>{Math.round(sampleRate * 100)}% of runs also run on <b {...stylex.props(text.strong, text.mono)}>{config.data?.config.calibration.baselineRoute.model}</b> in a second worktree, so every routing claim is measured, not assumed.</> : 'Calibration sampling is off; Jev’s routes are not being compared with the baseline.'}</p>
            <div {...stylex.props(styles.expTiles)}>
              <div {...stylex.props(styles.expTile)}><div {...stylex.props(styles.expValue, text.grad)}>{pct(jevSuccess)}</div><div {...stylex.props(text.mono, text.xs, text.muted)}>Jev · verified</div></div>
              <div {...stylex.props(styles.expTile)}><div {...stylex.props(styles.expValue, text.amber)}>{pct(baseSuccess)}</div><div {...stylex.props(text.mono, text.xs, text.muted)}>baseline · verified</div></div>
            </div>
            <div {...stylex.props(layout.row, text.mono, text.xs, text.muted)}><span>{report?.pairedSampleSize ?? 0} pairs</span></div>
            <div {...stylex.props(layout.row)}>
              {rate === null
                ? <Button size="sm" icon={Sparkles} disabled={!config.data} onClick={() => setRate(String(Math.round((sampleRate ?? 0.25) * 100)))}>Sample rate {sampleRate === null ? '—' : `${Math.round(sampleRate * 100)}%`}</Button>
                : <><TextInput label="Sample rate percent" type="number" mono value={rate} onChange={setRate} style={styles.rateInput} trailing="%" /><Button size="sm" variant="primary" busy={save.isPending} onClick={() => { const value = Number(rate); if (Number.isFinite(value) && value >= 0 && value <= 100) setSampleRate(value / 100); }}>Save</Button></>}
              {sampleRate ? <Button size="sm" variant="danger" icon={Square} busy={save.isPending && rate === null} onClick={() => setSampleRate(0)}>Stop</Button> : null}
            </div>
            {save.isSuccess && save.data.restartRequired && <Notice tone="warn" title="Saved. Restart the daemon to apply it." />}
          </Card>
        </section>
      </div>
    </AppFrame>
  );
}

