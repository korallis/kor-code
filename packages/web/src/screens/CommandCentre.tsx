// Screen 1, Home: what needs the owner now, and acting on it in place.
import * as stylex from '@stylexjs/stylex';
import { Activity as ActivityIcon, ArrowRight, Bot, BrainCircuit, Coins, Cpu, FolderKanban, Gauge, GitPullRequest, ListTodo, MessageSquare, Play, Send, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { MissionRun } from '@kor-code/mission-control';
import type { LinearIssue } from '@kor-code/linear';
import type { DecisionRecord } from '@kor-code/core';
import { ApiFailure } from '../api/client';
import { useMissionRuns, useOverrides, usePoolLive, useDecisions } from '../api/data';
import { isOpen, issueKey, useAllIssues } from '../api/issues';
import { useLive } from '../api/live';
import { useBrain, useConfig, useProjects, useQueue, useRunAction, useRunMessage } from '../api/queries';
import { href, navigate } from '../router';
import { AppFrame } from '../shell/AppFrame';
import { AskJev } from '../shell/AskJev';
import { initials, projectTone } from '../shell/projectTone';
import { color, font, space, tint } from '../theme/tokens.stylex';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader, CountChip } from '../ui/card';
import { Bar, Donut, Ring, Spark } from '../ui/charts';
import { Priority, Swatch, Tile } from '../ui/glyphs';
import { Empty, Feed, FeedItem, Notice } from '../ui/misc';
import { JevOrb } from '../ui/orb';
import { Pill, ProvenanceChip } from '../ui/pill';
import { TextArea } from '../ui/form';
import { layout } from '../ui/layout';
import { text, type Tone } from '../ui/text';
import { CountUp } from '../ui/count';
import { MotionMedia } from '../motion/MotionMedia';
import { buildActivity } from '../lib/activity';
import { plural, shortModel, usd } from '../lib/format';
import { isActive, keyOf, needsYou, readyToShip, runUpdatedAt, spendOn } from '../lib/runs';
import { parseQuota, sessionWindow, weeklyWindow, providerTitle } from '../lib/quota';
import { ago, clock, greeting, isToday, longDate, shortDate, useNow } from '../lib/time';
import { page, QueryError, RunRow } from './shared';

const NARROW = '@media (max-width: 1499px)';

const styles = stylex.create({
  hero: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) 432px', [NARROW]: 'minmax(0, 1fr) 380px' }, gap: space.s4 },
  hello: { paddingBlock: '22px', paddingInline: '26px', overflow: 'hidden' },
  halo: { position: 'absolute', right: '-140px', top: '-160px', width: '520px', height: '520px', borderRadius: '50%', backgroundImage: tint.heroHalo, pointerEvents: 'none' },
  orbit: { position: 'absolute', right: '22px', top: '14px', width: '250px', height: '150px', opacity: 0.95, pointerEvents: 'none' },
  heroMedia: { position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.8, zIndex: 0, borderRadius: 'inherit', overflow: 'hidden' },
  heroContent: { position: 'relative', zIndex: 1 },
  h1: { fontFamily: font.display, fontSize: { default: '46px', [NARROW]: '40px' }, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05, marginTop: '10px', position: 'relative' },
  pills: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', position: 'relative' },
  ask: { marginTop: '18px', position: 'relative' },
  needs: { paddingBlock: '18px 16px', paddingInline: '18px', display: 'flex', flexDirection: 'column' },
  needsTitle: { fontFamily: font.display, fontSize: '17px', fontWeight: 600, marginTop: '10px', letterSpacing: '-0.005em' },
  askQ: { marginTop: '12px', paddingBlock: '11px', paddingInline: '12px', borderRadius: '11px', backgroundColor: tint.wellSoft, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, fontSize: '13px', color: color.textSecondary, lineHeight: 1.5, display: 'flex', gap: '10px' },
  answerBox: { marginTop: '10px', minHeight: '98px', fontFamily: font.mono, fontSize: '12px', lineHeight: 1.7 },
  caption: { marginTop: '10px', fontSize: '12px', color: color.textMuted },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: space.s4 },
  kpi: { paddingBlock: '13px 12px', paddingInline: '16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gridTemplateRows: 'auto 1fr', gap: '6px 10px', height: '88px' },
  kpiLabel: { gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '7px', fontFamily: font.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden' },
  kpiValue: { fontFamily: font.display, fontSize: { default: '28px', [NARROW]: '24px' }, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em', display: 'flex', alignItems: 'baseline', gap: '8px', whiteSpace: 'nowrap', alignSelf: 'end' },
  kpiSmall: { fontFamily: font.sans, fontSize: '12px', fontWeight: 400, color: color.textMuted, letterSpacing: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  kpiArt: { alignSelf: 'end', marginBottom: '-2px', display: { default: null, [NARROW]: 'none' } },
  row3: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1.18fr) minmax(0, 0.92fr)', [NARROW]: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: space.s4, minHeight: '312px' },
  row4: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr)', [NARROW]: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: space.s4, minHeight: '200px' },
  spanNarrow: { gridColumn: { default: null, [NARROW]: '1 / -1' } },
  proj: { display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) 120px 40px', alignItems: 'center', gap: '12px', paddingBlock: '6px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, color: color.text },
  projName: { fontWeight: 500, fontSize: '13.5px' },
  projSub: { fontSize: '11.5px', color: color.textMuted, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  pc: { fontFamily: font.mono, fontSize: '12px', textAlign: 'right', color: color.textSecondary },
  usage: { display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', gap: '18px', alignItems: 'center' },
  legend: { display: 'grid', gap: '7px', fontSize: '12.5px' },
  li: { display: 'grid', gridTemplateColumns: '9px minmax(0, 1fr) auto auto', gap: '9px', alignItems: 'center' },
  liPct: { fontFamily: font.mono, fontSize: '11.5px', color: color.text },
  liCost: { fontFamily: font.mono, fontSize: '11px', color: color.textMuted, width: '44px', textAlign: 'right' },
  window: { display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr) 92px', whiteSpace: 'nowrap', gap: '10px', alignItems: 'center', fontSize: '12px', marginTop: '10px' },
  windowName: { fontFamily: font.mono, fontSize: '10.5px', color: color.textMuted, letterSpacing: '.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis' },
  windowVal: { fontFamily: font.mono, fontSize: '11px', color: color.textSecondary, textAlign: 'right' },
  next: { display: 'grid', gridTemplateColumns: '16px 74px minmax(0, 1fr) auto', gap: '10px', alignItems: 'center', paddingBlock: '8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, fontSize: '13px' },
  quote: { display: 'block', fontFamily: font.display, fontSize: '15px', lineHeight: 1.45, color: color.text, marginTop: '12px' },
  insight: { padding: '18px' },
  donutTotal: { fontFamily: font.display, fontSize: '24px', fontWeight: 600 },
  donutLabel: { fontFamily: font.mono, fontSize: '10px', letterSpacing: '.08em', color: color.textMuted },
  ember: { position: 'absolute', inset: 0, opacity: 0.22, pointerEvents: 'none', borderRadius: 'inherit', overflow: 'hidden' },
  now: { marginTop: '12px', paddingBlock: '14px', paddingInline: '16px', borderRadius: '14px', backgroundImage: tint.jevAnswer, borderWidth: '1px', borderStyle: 'solid', borderColor: tint.violetSoftEdge, position: 'relative' },
  nowText: { marginTop: '8px', color: color.textSecondary, fontSize: '13.5px', lineHeight: 1.6 },
  more: { fontSize: '12px', color: color.violetBright, display: 'inline-flex', alignItems: 'center', gap: '4px' },
});

const MODEL_TONES: readonly Tone[] = ['violet', 'cyan', 'green', 'amber', 'magenta', 'sky', 'orange'];

function Orbit({ keys }: { keys: readonly string[] }) {
  const nodes = [[75, 72, 96, 62, 'cyan'], [236, 82, 104, 206, 'green'], [196, 25, 18, 200, 'amber'], [128, 128, 146, 100, 'violet']] as const;
  return (
    <svg viewBox="0 0 250 150" fill="none" aria-hidden="true" {...stylex.props(styles.orbit)}>
      <defs>
        <radialGradient id="kor-core"><stop offset="0" {...stylex.props(orbitStop.white)} /><stop offset=".3" {...stylex.props(orbitStop.core)} /><stop offset="1" stopOpacity="0" {...stylex.props(orbitStop.violet)} /></radialGradient>
        <linearGradient id="kor-orb" x1="0" x2="1"><stop offset="0" stopOpacity=".15" {...stylex.props(orbitStop.violetBright)} /><stop offset=".5" stopOpacity=".7" {...stylex.props(orbitStop.violetBright)} /><stop offset="1" stopOpacity=".2" {...stylex.props(orbitStop.cyan)} /></linearGradient>
      </defs>
      <ellipse cx="160" cy="75" rx="86" ry="30" stroke="url(#kor-orb)" strokeWidth="1" />
      <ellipse cx="160" cy="75" rx="62" ry="54" stroke="url(#kor-orb)" strokeWidth="1" transform="rotate(-24 160 75)" />
      <ellipse cx="160" cy="75" rx="40" ry="66" stroke="url(#kor-orb)" strokeWidth="1" transform="rotate(38 160 75)" opacity=".7" />
      <circle cx="160" cy="75" r="30" fill="url(#kor-core)" />
      <circle cx="160" cy="75" r="7" {...stylex.props(orbitTone.white)} />
      {keys.slice(0, 4).map((key, index) => {
        const [x, y, ty, tx, tone] = nodes[index]!;
        return (
          <g key={key}>
            <circle cx={x} cy={y} r="3.5" {...stylex.props(orbitTone[tone])} />
            <text x={tx} y={ty} fontSize="8.5" letterSpacing="1" {...stylex.props(orbitTone.label)}>{key}</text>
          </g>
        );
      })}
    </svg>
  );
}
const orbitStop = stylex.create({
  white: { stopColor: tint.white },
  core: { stopColor: tint.markCore },
  violet: { stopColor: color.violet },
  violetBright: { stopColor: color.violetBright },
  cyan: { stopColor: color.cyan },
});
const orbitTone = stylex.create({
  white: { fill: tint.white, filter: `drop-shadow(0 0 8px ${color.violetBright})` },
  label: { fill: color.textMuted, fontFamily: font.mono },
  cyan: { fill: color.cyan, filter: `drop-shadow(0 0 6px ${color.cyan})` },
  green: { fill: color.green, filter: `drop-shadow(0 0 6px ${color.green})` },
  amber: { fill: color.amber, filter: `drop-shadow(0 0 6px ${color.amber})` },
  violet: { fill: color.violetBright, filter: `drop-shadow(0 0 6px ${color.violetBright})` },
});

function NeedsYou({ run, now, linearUrl, decisions }: { run: MissionRun | undefined; now: number; linearUrl?: string | undefined; decisions: DecisionRecord[] }) {
  const [answer, setAnswer] = useState('');
  const message = useRunMessage();
  const action = useRunAction();
  if (!run) {
    return (
      <Card index={1} pad label="Needs you">
        <Pill tone="green" dot>NOTHING NEEDS YOU</Pill>
        <Empty slot="empty-no-runs" title="Every run is moving on its own.">When Jev needs an answer or a run is blocked, it lands here with an answer box.</Empty>
      </Card>
    );
  }
  const send = () => { if (answer.trim()) message.mutate({ action: 'answer', executionId: run.executionId, body: { message: answer.trim() } }, { onSuccess: () => setAnswer('') }); };
  const error = message.error ?? action.error;
  return (
    <Card index={1} variant="attention" style={styles.needs} label="Needs you">
      <MotionMedia slot="needs-you-ember" fallback={null} style={styles.ember} />
      <div {...stylex.props(layout.row)}>
        <Pill tone="amber" dot pulse>NEEDS YOU</Pill>
        <a href={href('linear', run.executionId)} {...stylex.props(text.key)}>{keyOf(run)}</a>
        <span {...stylex.props(text.muted, text.mono, text.xs, text.ellipsis)}>{run.status}{run.errorCode ? ` · ${run.errorCode}` : ''}</span>
        <span {...stylex.props(layout.grow)} />
        <span {...stylex.props(text.muted, text.mono, text.xs)}>{runUpdatedAt(run) ? `${ago(runUpdatedAt(run), now)} ago` : 'undated'}</span>
      </div>
      <h3 {...stylex.props(styles.needsTitle)}>{run.issueTitle ?? run.issueId}</h3>
      <div {...stylex.props(layout.row, text.muted, text.sm, layout.mt1)}>
        {run.repository && <><span {...stylex.props(layout.none)}><Swatch tone="green" /></span>{run.repository} · </>}Linear: {run.issueState ?? '—'} · {plural(run.attempts, 'attempt')} · {usd(run.costUsd)} so far
      </div>
      <div {...stylex.props(styles.askQ)}>
        <JevOrb size={18} />
        <div><b {...stylex.props(text.strong)}>Jev asks:</b> {run.needsInput?.reason ?? run.error ?? 'This run is blocked and needs your direction before it can continue.'}</div>
      </div>
      <TextArea label={`Answer for ${keyOf(run)}`} value={answer} onChange={setAnswer} mono rows={4} placeholder="Answer Jev. ⌘↵ sends." onSubmit={send} style={styles.answerBox} />
      <div {...stylex.props(styles.caption)}>Kor writes your answer to the Linear issue as a comment, then retries the run.</div>
      {error && <div {...stylex.props(layout.mt2)}><Notice title={error.message} hint={error instanceof ApiFailure ? error.hint : undefined} /></div>}
      {message.isSuccess && <div {...stylex.props(layout.mt2)}><Notice tone="ok" title="Sent. The run is queued again." /></div>}
      <div {...stylex.props(layout.row, layout.mt3)}>
        <Button variant="primary" icon={Send} busy={message.isPending} disabled={!answer.trim()} onClick={send}>Send and retry</Button>
        {(run.issueUrl ?? linearUrl) && <Button brand="linear" href={run.issueUrl ?? linearUrl} external>Open in Linear</Button>}
        <span {...stylex.props(layout.grow)} />
        <Button variant="danger-ghost" busy={action.isPending} onClick={() => action.mutate({ action: 'cancel', executionId: run.executionId })}>Cancel run</Button>
      </div>
    </Card>
  );
}

/** Until Jev answers, the hero shows what needs attention right now, straight from the live runs. */
function RightNow({ attention, ready, queued }: { attention: MissionRun[]; ready: MissionRun[]; queued: MissionRun[] }) {
  const items = [
    ...attention.slice(0, 1).map(run => ({ run, text: `is ${run.status}: ${run.needsInput?.reason ?? run.error ?? 'it needs your direction.'}` })),
    ...ready.slice(0, 1).map(run => {
      const checks = run.verification?.attempts.at(-1)?.checks ?? [];
      const findings = run.verification?.attempts.at(-1)?.findings ?? [];
      return { run, text: `passed ${checks.filter(c => c.status === 'pass').length} of ${checks.length} checks and ${findings.filter(f => f.status === 'pass').length} of ${findings.length} acceptance conditions, and is waiting for your approval to ship.` };
    }),
    ...queued.slice(0, 1).map(run => ({ run, text: 'is queued; it starts when a slot frees under the limits.' })),
  ];
  if (items.length === 0) return null;
  return (
    <div {...stylex.props(styles.now)}>
      <div {...stylex.props(layout.row)}><span {...stylex.props(text.eyebrow, text.violet)}>Right now</span><span {...stylex.props(text.mono, text.faint, text.xs)}>from the live runs</span></div>
      <p {...stylex.props(styles.nowText)}>{items.map(({ run, text: line }) => <span key={run.executionId}><b {...stylex.props(text.key)}>{keyOf(run)}</b> {line} </span>)}</p>
      <div {...stylex.props(layout.rowWrap, layout.mt3)}>
        {ready[0] && <Button size="sm" variant="primary" icon={GitPullRequest} onClick={() => navigate('linear', ready[0]!.executionId)}>Review {keyOf(ready[0])} and ship</Button>}
        {attention[0] && <Button size="sm" icon={MessageSquare} onClick={() => navigate('linear', attention[0]!.executionId)}>Open {keyOf(attention[0])}</Button>}
        {queued[0] && <Button size="sm" icon={Bot} onClick={() => navigate('agents', queued[0]!.executionId)}>See {keyOf(queued[0])} in Agents</Button>}
      </div>
    </div>
  );
}

function Kpi({ index, icon: Glyph, tone, label, value, small, art }: { index: number; icon: typeof Bot; tone: Tone; label: string; value: React.ReactNode; small: React.ReactNode; art?: React.ReactNode }) {
  return (
    <Card index={index} style={styles.kpi}>
      <div {...stylex.props(styles.kpiLabel)}><Glyph size={13} strokeWidth={1.8} {...stylex.props(text[tone])} />{label}</div>
      <div {...stylex.props(styles.kpiValue)}>{value}<small {...stylex.props(styles.kpiSmall)}>{small}</small></div>
      <span {...stylex.props(styles.kpiArt)}>{art}</span>
    </Card>
  );
}

/** Cumulative series by time, for the "so far today" sparklines. */
function cumulative(points: readonly { at: number; value: number }[]): number[] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  let sum = 0;
  return [0, ...sorted.map(point => (sum += point.value))];
}

function NextUp({ issues, runs, intakeLabel }: { issues: readonly LinearIssue[]; runs: readonly MissionRun[]; intakeLabel: string }) {
  const queue = useQueue();
  const started = new Set(runs.map(run => run.issueId));
  const next = issues.filter(issue => isOpen(issue) && issue.stateType !== 'started' && issue.labels.includes(intakeLabel) && !started.has(issue.id))
    .sort((a, b) => (a.priority || 5) - (b.priority || 5)).slice(0, 4);
  if (next.length === 0) return <Empty slot="empty-no-issues" title={`No Todo issues labelled ${intakeLabel}.`}>Label an issue <b {...stylex.props(text.violet)}>{intakeLabel}</b> in Linear and it appears here.</Empty>;
  return (
    <>
      {queue.error && <Notice title={queue.error.message} hint={queue.error instanceof ApiFailure ? queue.error.hint : undefined} />}
      {next.map(issue => {
        const noCriteria = issue.acceptanceCriteria.length === 0;
        const pending = queue.isPending && queue.variables?.issueIds.includes(issue.id);
        return (
          <div key={issue.id} {...stylex.props(styles.next)}>
            <Priority value={issue.priority} />
            <span {...stylex.props(text.key)}>{issueKey(issue)}</span>
            <span {...stylex.props(text.ellipsis, noCriteria && text.amber)}>{issue.title}{noCriteria && <span {...stylex.props(text.muted)}> · no acceptance criteria</span>}</span>
            {noCriteria
              ? <Button size="sm" variant="warn" icon={MessageSquare} href={issue.url} external title="Add acceptance criteria in Linear">Add</Button>
              : <Button size="sm" icon={Play} busy={pending} onClick={() => queue.mutate({ issueIds: [issue.id] })}>Start</Button>}
          </div>
        );
      })}
    </>
  );
}

export function CommandCentre() {
  const now = useNow();
  const { runs, error: runsError } = useMissionRuns();
  const overrides = useOverrides();
  const decisions = useDecisions();
  const projects = useProjects();
  const config = useConfig();
  const brain = useBrain();
  const pool = usePoolLive();
  const activitySamples = useLive(live => live.activity);
  const projectList = projects.data?.projects ?? [];
  const issuesByProject = useAllIssues(projectList);
  const allIssues = issuesByProject.flatMap(entry => entry.issues);

  const active = runs.filter(isActive);
  const queued = runs.filter(run => run.status === 'queued' || run.status === 'ready');
  const attention = runs.filter(needsYou);
  const ready = runs.filter(readyToShip);
  const prsOpen = runs.filter(run => run.status === 'review' && run.pullRequestUrl);
  const today = runs.filter(run => isToday(runUpdatedAt(run), now));
  const verifiedToday = runs.filter(run => run.verifiedAt !== null && isToday(run.verifiedAt, now));
  const spentToday = spendOn(runs, iso => isToday(iso, now));
  const firstPass = verifiedToday.length ? verifiedToday.filter(run => (run.verification?.attempts.length ?? 0) <= 1).length / verifiedToday.length : null;
  const spendToday = spentToday.reduce((sum, entry) => sum + entry.costUsd, 0);
  const quota = parseQuota(pool.quota?.value ?? null);
  const claude = quota.find(provider => provider.provider === 'claude');
  const five = sessionWindow(claude);
  const shown = [...ready, ...active].slice(0, 3);
  const rest = [...ready, ...active, ...queued].slice(3);

  const spendByModel = new Map<string, number>();
  for (const { record, costUsd } of spentToday) if (costUsd) spendByModel.set(record.model, (spendByModel.get(record.model) ?? 0) + costUsd);
  const modelParts = [...spendByModel].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const windows = quota.flatMap(provider => [sessionWindow(provider), weeklyWindow(provider)].filter(Boolean).map(window => ({ provider, window: window! }))).filter(entry => !entry.provider.notSetUp).slice(0, 3);

  const activity = buildActivity(runs, overrides, decisions).slice(0, 4);
  const intakeLabel = config.data?.config.intakeLabel ?? 'kor';
  const learning = brain.data?.learnings.value[0];
  const activeSeries = activitySamples.length >= 2 ? activitySamples.map(sample => sample.active) : null;

  return (
    <AppFrame active="home" crumbs={['Command Centre']} showAsk={false}>
      <div {...stylex.props(page.page)}>
        <section {...stylex.props(styles.hero)}>
          <Card index={0} style={styles.hello} label="Greeting">
            <span {...stylex.props(styles.halo)} />
            <MotionMedia slot="hero-background" fallback={<Orbit keys={active.concat(attention, ready).map(keyOf)} />} style={styles.heroMedia} />
            <div {...stylex.props(styles.heroContent)}>
            <div {...stylex.props(text.eyebrow, text.violet)}>{longDate(now)} · Command Centre</div>
            <h1 {...stylex.props(styles.h1)}>{greeting(now).split(' ')[0]} <span {...stylex.props(text.grad)}>{greeting(now).split(' ')[1]}.</span></h1>
            <div {...stylex.props(styles.pills)}>
              <Pill tone="cyan" dot pulse={active.length > 0}>{active.length} running</Pill>
              <Pill tone="amber" dot>{attention.length} needs you</Pill>
              <Pill tone="magenta" dot>{ready.length} ready to ship</Pill>
              <Pill tone="violet" dot>{prsOpen.length} PRs open</Pill>
            </div>
            <div {...stylex.props(styles.ask)}>
              <AskJev placeholder="Ask Jev — what's blocked, and what can ship today?" idle={<RightNow attention={attention} ready={ready} queued={queued} />} />
            </div>
            </div>
          </Card>
          <NeedsYou key={attention[0]?.executionId ?? 'none'} run={attention[0]} now={now} decisions={decisions} />
        </section>

        {runsError && <QueryError error={runsError} what="Runs" />}

        <section {...stylex.props(styles.kpis)} aria-label="Today">
          <Kpi index={2} icon={Bot} tone="cyan" label="Active runs" value={<CountUp value={active.length} format={String} />} small={<><b {...stylex.props(text.secondary)}>+{queued.length}</b> queued</>}
            art={activeSeries && <Spark width={84} values={activeSeries} tone="cyan" label="active runs since this page opened" />} />
          <Kpi index={3} icon={ShieldCheck} tone="green" label="Verified today" value={<CountUp value={verifiedToday.length} format={String} />} small={firstPass === null ? 'none yet' : <><b {...stylex.props(text.secondary)}>{Math.round(firstPass * 100)}%</b> first pass</>}
            art={verifiedToday.length > 0 && <Spark width={84} values={cumulative(verifiedToday.map(run => ({ at: Date.parse(run.verifiedAt ?? ''), value: 1 })))} tone="green" label="verified runs today" />} />
          <Kpi index={4} icon={GitPullRequest} tone="violet" label="Pull requests" value={<CountUp value={prsOpen.length} format={String} />} small={<>open for <b {...stylex.props(text.secondary)}>review</b></>} />
          <Kpi index={5} icon={Coins} tone="amber" label="Spend today · costUsd" value={<CountUp value={spendToday} format={value => usd(value)} />} small={<><b {...stylex.props(text.secondary)}>{new Set(spentToday.map(entry => entry.run.executionId)).size}</b> runs</>}
            art={spentToday.length > 0 && <Spark width={84} values={cumulative(spentToday.map(entry => ({ at: Date.parse(entry.record.recordedAt), value: entry.costUsd })))} tone="amber" label="spend today" />} />
          <Kpi index={6} icon={Gauge} tone="violet" label={`${claude ? 'Claude' : 'Pool'} 5-hour pool`} value={five?.percentRemaining != null ? <CountUp value={five.percentRemaining} format={value => `${Math.round(value)}%`} /> : '—'}
            small={five?.resetsAt ? <>resets <b {...stylex.props(text.secondary)}>{clock(five.resetsAt)}</b></> : <ProvenanceChip provenance={pool.quota?.provenance ?? 'unavailable'} reason={pool.quota?.reason}>{pool.quota ? pool.quota.provenance : 'unavailable'}</ProvenanceChip>}
            art={five?.percentRemaining != null && <Ring pct={five.percentRemaining} size={38} stroke={5} label="5-hour window remaining" />} />
        </section>

        <section {...stylex.props(styles.row3)}>
          <Card index={7} clip>
            <CardHeader icon={FolderKanban} title="Active projects" count={projectList.length} aside={<a href={href('projects')} {...stylex.props(styles.more)}>All projects <ArrowRight size={12} /></a>} />
            <CardBody>
              {projects.error && <QueryError error={projects.error} what="Projects" />}
              {issuesByProject.slice(0, 6).map(({ project, issues, provenance, reason }, index) => {
                const done = issues.filter(issue => issue.stateType === 'completed').length;
                const open = issues.filter(isOpen).length;
                const pct = issues.length ? (done / issues.length) * 100 : 0;
                const running = project.runs.filter(isActive).length;
                const blocked = project.runs.filter(needsYou).length;
                return (
                  <a key={project.id} href={href('projects', project.id)} {...stylex.props(styles.proj)}>
                    <Tile tone={projectTone(index)}>{initials(project.name)}</Tile>
                    <div>
                      <div {...stylex.props(styles.projName)}>{project.name}</div>
                      <div {...stylex.props(styles.projSub)}>
                        {provenance === 'loading' ? 'reading Linear…' : provenance === 'unavailable' ? <span {...stylex.props(text.amber)} title={reason}>Linear unavailable</span> : <>{open} open · {running ? `${running} running` : 'idle'}{blocked ? <> · <span {...stylex.props(text.amber)}>{blocked} blocked</span></> : null}</>} · {project.repository.linearTeam ?? project.id}
                      </div>
                    </div>
                    <Bar pct={pct} label={`${project.name} done`} />
                    <span {...stylex.props(styles.pc)}>{issues.length ? `${Math.round(pct)}%` : '—'}</span>
                  </a>
                );
              })}
              {projectList.length === 0 && !projects.isPending && !projects.error && <Empty slot="empty-no-issues" title="No projects configured.">Add a repository in <a href={href('settings')} {...stylex.props(text.link)}>Settings</a>.</Empty>}
            </CardBody>
          </Card>

          <Card index={8} clip>
            <CardHeader icon={Bot} title="Running agents" count={`${active.length + ready.length}${queued.length ? ` + ${queued.length}` : ''}`} aside={<a href={href('agents')} {...stylex.props(styles.more)}>Agents <ArrowRight size={12} /></a>} />
            <CardBody>
              {shown.map(run => <RunRow key={run.executionId} run={run} now={now} />)}
              {rest.length > 0 && (
                <div {...stylex.props(layout.rowWrap, text.mono, text.muted, text.xs)}>
                  {rest.slice(0, 3).map(run => <a key={run.executionId} href={href('agents', run.executionId)} {...stylex.props(layout.row)}><Pill tone={run.status === 'queued' ? 'slate' : 'cyan'} dot small>{run.status}</Pill><span {...stylex.props(text.key)}>{keyOf(run)}</span></a>)}
                  {rest.length > 3 && <span>+{rest.length - 3} more</span>}
                </div>
              )}
              {shown.length === 0 && <Empty slot="empty-no-runs" title="No agents running.">Start an issue from Next up, or queue one from a project.</Empty>}
            </CardBody>
          </Card>

          <Card index={9} clip style={styles.spanNarrow}>
            <CardHeader icon={Cpu} title="Model usage" aside={<ProvenanceChip provenance={pool.quota?.provenance ?? 'unavailable'} reason={pool.quota?.reason}>{pool.quota ? `${pool.quota.provenance} · quota-axi ${ago(pool.quota.observedAt, now)}` : 'quota unavailable'}</ProvenanceChip>} />
            <CardBody>
              <div {...stylex.props(styles.usage)}>
                <Donut parts={modelParts.map(([, value], index) => ({ value, tone: MODEL_TONES[index]! }))} size={146} stroke={13} label="spend by model today">
                  <div {...stylex.props(styles.donutTotal)}>{usd(spendToday)}</div>
                  <div {...stylex.props(styles.donutLabel)}>TODAY</div>
                </Donut>
                <div {...stylex.props(styles.legend)}>
                  {modelParts.length === 0 && <span {...stylex.props(text.muted)}>No spend recorded today.</span>}
                  {modelParts.map(([model, value], index) => (
                    <div key={model} {...stylex.props(styles.li)}>
                      <Swatch tone={MODEL_TONES[index]!} /><span {...stylex.props(text.ellipsis)}>{shortModel(model)}</span>
                      <span {...stylex.props(styles.liPct)}>{spendToday ? Math.round((value / spendToday) * 100) : 0}%</span>
                      <span {...stylex.props(styles.liCost)}>{usd(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div {...stylex.props(layout.divider, layout.mt3)} />
              {windows.map(({ provider, window }) => (
                <div key={`${provider.provider}-${window.id}`} {...stylex.props(styles.window)}>
                  <span {...stylex.props(styles.windowName)}>{providerTitle(provider.provider)} {window.kind === 'session' ? '5h' : window.kind === 'weekly' ? 'wk' : window.label}</span>
                  <Bar pct={window.percentRemaining ?? 0} tone={(window.percentRemaining ?? 100) < 30 ? 'amber' : 'brand'} label={`${provider.provider} ${window.label}`} />
                  <span {...stylex.props(styles.windowVal)}>{window.percentRemaining != null ? `${Math.round(window.percentRemaining)}%` : '—'}{window.resetsAt ? ` · ${window.kind === 'session' ? clock(window.resetsAt) : shortDate(window.resetsAt).split(' ').slice(0, 2).join(' ')}` : ''}</span>
                </div>
              ))}
              {windows.length === 0 && <div {...stylex.props(layout.mt3)}><ProvenanceChip provenance="unavailable" reason={pool.quota?.reason}>no quota windows reported</ProvenanceChip></div>}
            </CardBody>
          </Card>
        </section>

        <section {...stylex.props(styles.row4)}>
          <Card index={10} clip>
            <CardHeader icon={ActivityIcon} title="Recent activity" aside={<a href={href('agents')} {...stylex.props(styles.more)}>Log <ArrowRight size={12} /></a>} />
            <CardBody>
              <Feed>
                {activity.map(item => (
                  <a key={item.id} href={href('agents', item.executionId)}>
                    <FeedItem tone={item.tone} icon={item.icon} when={ago(item.at, now)}><b {...stylex.props(text.strong)}>{item.key}</b> {item.text}</FeedItem>
                  </a>
                ))}
              </Feed>
              {activity.length === 0 && <span {...stylex.props(text.muted)}>Nothing has happened yet.</span>}
            </CardBody>
          </Card>
          <Card index={11} clip>
            <CardHeader icon={ListTodo} title="Next up" aside={<span {...stylex.props(text.muted, text.mono, text.xs)}>label <span {...stylex.props(text.violet)}>{intakeLabel}</span> · Todo</span>} />
            <CardBody><NextUp issues={allIssues} runs={runs} intakeLabel={intakeLabel} /></CardBody>
          </Card>
          <Card index={12} variant="insight" style={[styles.insight, styles.spanNarrow]}>
            <div {...stylex.props(layout.row)}><JevOrb size={26} /><span {...stylex.props(text.eyebrow, text.violet)}>Jev learned</span><span {...stylex.props(layout.grow)} />{brain.data && <ProvenanceChip provenance={brain.data.learnings.provenance} reason={brain.data.learnings.reason} />}</div>
            {learning ? <q {...stylex.props(styles.quote)}>{learning}</q> : <p {...stylex.props(styles.quote, text.muted)}>{brain.error ? `Learnings unavailable: ${brain.error.message}` : brain.data?.learnings.provenance === 'unavailable' ? `Learnings unavailable: ${brain.data.learnings.reason ?? 'not reported by the daemon'}.` : 'No learnings yet. Jev proposes one once calibration has enough finished runs to compare.'}</p>}
            <div {...stylex.props(layout.row, layout.mt3)}><Button size="sm" variant="violet" icon={BrainCircuit} onClick={() => navigate('brain')}>See why</Button></div>
          </Card>
        </section>
      </div>
    </AppFrame>
  );
}

