// Screen 3: every Kor run, live, and the live agent terminal for one of them.
import * as stylex from '@stylexjs/stylex';
import { Bot, Clock, FolderGit2, GitBranch, History, Plus, RotateCcw, Send, Square, CircleCheck, CircleX, CircleDashed, Cpu, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import type { MissionRun } from '@kor-code/mission-control';
import type { DecisionRecord } from '@kor-code/core';
import { ApiFailure } from '../api/client';
import { useDecisions, useMissionRuns } from '../api/data';
import { useLive } from '../api/live';
import { useRunTerminal } from '../api/terminal';
import { useConfig, useRunAction, useRunMessage } from '../api/queries';
import { href, navigate } from '../router';
import { AppFrame } from '../shell/AppFrame';
import { color, font, gradient, space, tint } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';
import { Button } from '../ui/button';
import { Card, CardHeader } from '../ui/card';
import { TextArea, Segmented } from '../ui/form';
import { Empty, Notice } from '../ui/misc';
import { JevOrb } from '../ui/orb';
import { Pill, ProvenanceChip, StatusPill } from '../ui/pill';
import { StageTrack } from '../ui/stages';
import { PillTabs } from '../ui/tabs';
import { Terminal } from '../ui/terminal';
import { DiffView } from '../ui/diff';
import { Icon } from '../ui/icon';
import { layout } from '../ui/layout';
import { text } from '../ui/text';
import { MotionMedia } from '../motion/MotionMedia';
import { compact, prob, shortModel, usd } from '../lib/format';
import { parseDiff } from '../lib/diff';
import { parseTerminal, sessionUsage } from '../lib/terminal';
import { byAttention, decisionsFor, isActive, keyOf, latestVerification, prNumber, slotOf, FINISHED } from '../lib/runs';
import { ago, duration, isToday, useNow } from '../lib/time';
import { page } from './shared';
import { nextStep } from './runText';
import { QueueDialog } from './QueueDialog';

const NARROW = '@media (max-width: 1439px)';

const styles = stylex.create({
  head: { display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' },
  lede: { color: color.textMuted, fontSize: '13px', marginTop: '3px' },
  slots: { display: 'flex', alignItems: 'center', gap: '10px', paddingBlock: '8px', paddingInline: '14px', borderRadius: '12px', borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, backgroundColor: color.surface, fontSize: '12px', color: color.textSecondary, whiteSpace: 'nowrap' },
  pips: { display: 'flex', gap: '4px' },
  pip: { width: '18px', height: '8px', borderRadius: '3px', backgroundColor: tint.ghostStrong },
  pipOn: { backgroundImage: gradient.progress, boxShadow: tint.barGlowCyan },
  body: { display: 'grid', gridTemplateColumns: { default: '404px minmax(0, 1fr)', [NARROW]: '340px minmax(0, 1fr)' }, gap: space.s4, height: 'calc(100vh - 64px - 40px - 48px - 74px)', minHeight: '640px' },
  list: { display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0, overflowY: 'auto', paddingRight: '2px', scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  agent: { paddingBlock: '13px 12px', paddingInline: '14px', display: 'grid', gap: '8px', cursor: 'pointer', flex: 'none' },
  agentSel: { backgroundImage: `linear-gradient(135deg, ${color.violetDim}, ${color.cyanDim})` },
  agentTop: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  agentTitle: { fontSize: '13.5px', fontWeight: 500 },
  meta: { display: 'flex', gap: '10px', fontFamily: font.mono, fontSize: '10.5px', color: color.textMuted, alignItems: 'center', minWidth: 0 },
  nx: { fontSize: '12px', color: color.textSecondary, display: 'flex', gap: '6px', alignItems: 'baseline', minWidth: 0 },
  nxLabel: { fontFamily: font.mono, fontSize: '9.5px', letterSpacing: '.1em', color: color.textFaint, fontWeight: 500, flex: 'none' },
  finished: { display: 'grid', gridTemplateColumns: 'auto 74px minmax(0, 1fr) auto', gap: '10px', alignItems: 'center', paddingBlock: '5px', fontSize: '13px' },
  term: { display: 'grid', gridTemplateRows: 'auto auto auto minmax(0, 1fr)', overflow: 'hidden', minHeight: 0 },
  th: { display: 'flex', alignItems: 'center', gap: '12px', paddingBlock: '16px 12px', paddingInline: '18px', minWidth: 0 },
  thTitle: { fontFamily: font.display, fontSize: '19px', fontWeight: 600, letterSpacing: '-0.01em' },
  facts: { display: 'flex', gap: '16px', paddingInline: '18px', paddingBottom: '14px', overflow: 'hidden', fontFamily: font.mono, fontSize: '11px', color: color.textMuted, whiteSpace: 'nowrap' },
  fact: { display: 'inline-flex', gap: '6px', alignItems: 'center' },
  stageWrap: { paddingInline: '18px', paddingBottom: '14px' },
  split: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) 292px', [NARROW]: 'minmax(0, 1fr) 256px' }, minHeight: 0, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: color.hairline },
  pane: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
  tabs: { display: 'flex', alignItems: 'center', gap: '2px', paddingBlock: '8px', paddingInline: '12px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline, backgroundColor: color.codeBg, overflowX: 'auto', scrollbarWidth: 'none' },
  paneBody: { flex: '1', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  scroll: { flex: '1', minHeight: 0, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  notes: { margin: '12px', paddingBlock: '12px', paddingInline: '14px', borderRadius: '12px', borderWidth: '1px', borderStyle: 'solid', borderColor: tint.violetSoftEdge, backgroundImage: tint.jevAnswer, display: 'flex', gap: '12px', fontSize: '12.5px', color: color.textSecondary, lineHeight: 1.55, flex: 'none' },
  rail: { borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: color.hairline, paddingBlock: '14px', paddingInline: '16px', display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: tint.wellSoft, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none' },
  ac: { display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gap: '8px', fontSize: '12px', color: color.textSecondary, lineHeight: 1.4, paddingBlock: '5px' },
  acId: { fontFamily: font.mono, fontSize: '10px', color: color.textFaint, display: 'block' },
  pend: { width: '13px', height: '13px', borderRadius: '50%', borderWidth: '1.5px', borderStyle: 'dashed', borderColor: color.textFaint, marginTop: '2px' },
  nextbox: { paddingBlock: '11px', paddingInline: '12px', borderRadius: '11px', backgroundColor: tint.violetFill, borderWidth: '1px', borderStyle: 'solid', borderColor: tint.jevCardEdge, fontSize: '12.5px', color: color.textSecondary, lineHeight: 1.5 },
  usage: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  tile: { paddingBlock: '8px', paddingInline: '10px', borderRadius: '9px', backgroundColor: tint.ghost, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline },
  tileValue: { display: 'block', fontFamily: font.display, fontSize: '15px', fontWeight: 600 },
  tileLabel: { fontSize: '10.5px', color: color.textMuted },
  check: { display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) auto', gap: '8px', alignItems: 'start', fontSize: '12.5px' },
  output: { gridColumn: '2 / -1', fontFamily: font.mono, fontSize: '11px', color: color.textMuted, whiteSpace: 'pre-wrap', maxHeight: '160px', overflowY: 'auto', backgroundColor: color.codeBg, borderRadius: '8px', padding: '8px 10px' },
  decision: { display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr) auto', gap: '10px', alignItems: 'baseline', paddingBlock: '8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, fontSize: '12.5px' },
  shipped: { position: 'absolute', right: '12px', top: '12px', width: '120px', height: '120px', pointerEvents: 'none', zIndex: 3 },
  steer: { minHeight: '64px' },
});

function AgentCard({ run, selected, now, index }: { run: MissionRun; selected: boolean; now: number; index: number }) {
  const action = useRunAction();
  const step = nextStep(run);
  const elapsed = run.heartbeatAt ? duration(now - Date.parse(run.observedAt) + (Date.parse(run.observedAt) - Date.parse(run.heartbeatAt))) : null;
  return (
    <Card index={index} variant={selected ? 'neon' : run.status === 'blocked' ? 'attention' : 'plain'} style={[styles.agent, selected && styles.agentSel]} as="article" label={keyOf(run)}>
      <a href={href('agents', run.executionId)} {...stylex.props(layout.stackTight)}>
        <div {...stylex.props(styles.agentTop)}>
          <span {...stylex.props(text.key)}>{keyOf(run)}</span>
          <span {...stylex.props(styles.agentTitle, text.ellipsis)}>{run.issueTitle ?? run.issueId}</span>
          <span {...stylex.props(layout.grow)} />
          <StatusPill status={run.status} small detail={run.status === 'queued' ? undefined : undefined} />
        </div>
        <div {...stylex.props(styles.meta)}>
          <span>{shortModel(run.route?.model)}</span>
          {slotOf(run) && <><span {...stylex.props(text.faint)}>·</span><span>{slotOf(run)}</span></>}
          {run.routeSource === 'override' && <><span {...stylex.props(text.faint)}>·</span><span {...stylex.props(text.amber)}>override</span></>}
          {run.routeSource === 'jev' && <><span {...stylex.props(text.faint)}>·</span><span>jev</span></>}
          <span {...stylex.props(layout.grow)} />
          {elapsed && isActive(run) && <span>{elapsed}</span>}
          <span>{usd(run.costUsd)}</span>
        </div>
        {run.status !== 'queued' && <StageTrack stage={run.stage} status={run.status} />}
      </a>
      <div {...stylex.props(styles.nx)}>
        <b {...stylex.props(styles.nxLabel)}>{step.label}</b>
        <span {...stylex.props(text.ellipsis, layout.grow)}>{step.text}</span>
        {run.status === 'waiting' && <Button size="sm" variant="primary" onClick={() => navigate('linear', run.executionId)}>Review</Button>}
        {(run.status === 'blocked' || run.status === 'escalated') && <Button size="sm" variant="warn" onClick={() => navigate('home')}>Answer</Button>}
        {run.status === 'queued' && <span title="Kor starts queued runs as slots free; there is no jump-the-queue control in the daemon."><Pill tone="slate" small>queued</Pill></span>}
        {(run.status === 'failed' || run.status === 'canceled') && <Button size="sm" icon={RotateCcw} busy={action.isPending} onClick={() => action.mutate({ action: 'retry', executionId: run.executionId })}>Retry</Button>}
      </div>
    </Card>
  );
}

type TermTab = 'live' | 'plan' | 'changes' | 'checks' | 'decisions' | 'log';

function DecisionRow({ decision }: { decision: DecisionRecord }) {
  return (
    <div {...stylex.props(styles.decision)}>
      <span {...stylex.props(text.mono, text.violet)}>{decision.kind}</span>
      <span>
        <b {...stylex.props(text.strong)}>{decision.choice}</b>{decision.escalated && <> <Pill tone="amber" small>escalated</Pill></>}
        <span {...stylex.props(text.muted)}> · {decision.reasons.slice(0, 2).join(' · ')}</span>
        {decision.candidates.length > 1 && <span {...stylex.props(text.faint, text.mono, text.xs)}> · candidates {decision.candidates.join(', ')}</span>}
      </span>
      <span {...stylex.props(text.mono)}>{prob(decision.confidence)}</span>
    </div>
  );
}

function RunTerminal({ run, decisions, now }: { run: MissionRun; decisions: DecisionRecord[]; now: number }) {
  const [tab, setTab] = useState<TermTab>('live');
  const [note, setNote] = useState('');
  const terminal = useRunTerminal(run.executionId);
  const action = useRunAction();
  const message = useRunMessage();
  const [copied, setCopied] = useState(false);
  const lines = parseTerminal(terminal.text);
  const usage = sessionUsage(terminal.text);
  const attempt = latestVerification(run);
  const diffs = attempt ? parseDiff(attempt.diff) : [];
  const findings = attempt?.findings ?? [];
  const evidence = attempt?.evidence ?? [];
  const runDecisions = decisionsFor(decisions, run.executionId);
  const supervise = [...runDecisions].reverse().find(decision => decision.kind === 'route') ?? runDecisions.at(-1);
  const step = nextStep(run);
  const live = isActive(run);
  const shippedAt = useLive(live => live.shippedAt[run.executionId] ?? 0);
  const finished = FINISHED.has(run.status);
  const cacheRate = usage && usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens > 0 ? usage.cacheReadTokens / (usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens) : null;
  const sendNote = () => { if (note.trim()) message.mutate({ action: 'note', executionId: run.executionId, body: { message: note.trim() } }, { onSuccess: () => setNote('') }); };
  const copyWorktree = () => { if (run.worktree) void navigator.clipboard?.writeText(run.worktree).then(() => setCopied(true)); };
  const error = action.error ?? message.error;
  const tabs = [
    { value: 'live' as const, label: <><span {...stylex.props(text.green)}>●</span> Live output</> },
    { value: 'plan' as const, label: 'Plan' },
    { value: 'changes' as const, label: 'Changes', count: diffs.length || undefined },
    { value: 'checks' as const, label: 'Checks', count: attempt?.checks.length || undefined },
    { value: 'decisions' as const, label: 'Decisions', count: runDecisions.length || undefined },
    { value: 'log' as const, label: 'Log' },
  ];
  return (
    <Card index={1} flex style={styles.term} label={`Terminal for ${keyOf(run)}`}>
      {shippedAt > 0 && now - shippedAt < 4_000 && <MotionMedia slot="pr-shipped" once playKey={shippedAt} fallback={<span {...stylex.props(animate.fadeIn)}><Pill tone="green" dot>{run.status === 'review' ? 'PR opened' : 'merged'}</Pill></span>} style={styles.shipped} />}
      <div {...stylex.props(styles.th)}>
        <span {...stylex.props(text.key, text.lg)}>{keyOf(run)}</span>
        <h2 {...stylex.props(styles.thTitle, text.ellipsis)}>{run.issueTitle ?? run.issueId}</h2>
        <StatusPill status={run.status} detail={run.stage} />
        <span {...stylex.props(layout.grow)} />
        {run.worktree && <Button size="sm" icon={copied ? CircleCheck : FolderGit2} title={run.worktree} onClick={copyWorktree}>{copied ? 'Copied' : 'Worktree'}</Button>}
        {run.issueUrl && <Button size="sm" brand="linear" href={run.issueUrl} external>Linear</Button>}
        {run.pullRequestUrl && <Button size="sm" icon={GitPullRequest} href={run.pullRequestUrl} external>{prNumber(run.pullRequestUrl) ?? 'PR'}</Button>}
        {!finished && <Button size="sm" variant="danger" icon={Square} busy={action.isPending && action.variables?.action === 'cancel'} onClick={() => action.mutate({ action: 'cancel', executionId: run.executionId })}>{run.cancelRequested ? 'Stopping…' : 'Stop run'}</Button>}
      </div>
      <div {...stylex.props(styles.facts)}>
        <span {...stylex.props(styles.fact)}><Icon icon={Cpu} size={12} />{run.route?.model ?? 'no route yet'}{run.routeSource && <> · <b {...stylex.props(text.secondary)}>{run.routeSource === 'override' ? 'override (you)' : run.routeSource}</b></>}</span>
        <span {...stylex.props(styles.fact)} title={run.accountSlot.reason}><Icon icon={Bot} size={12} />{run.accountSlot.value ?? 'slot unreported'}</span>
        {run.branch && <span {...stylex.props(styles.fact)}><Icon icon={GitBranch} size={12} />{run.branch}</span>}
        <span {...stylex.props(styles.fact)}><Icon icon={RotateCcw} size={12} />attempt {run.attempts}</span>
        {run.heartbeatAt && <span {...stylex.props(styles.fact)}><Icon icon={Clock} size={12} />heartbeat {ago(run.heartbeatAt, now)} ago</span>}
      </div>
      <div {...stylex.props(styles.stageWrap)}><StageTrack stage={run.stage} status={run.status} labels large /></div>
      <div {...stylex.props(styles.split)}>
        <div {...stylex.props(styles.pane)}>
          <div {...stylex.props(styles.tabs)}><PillTabs value={tab} items={tabs} onChange={setTab} label="Run views" /></div>
          <div {...stylex.props(styles.paneBody)}>
            {tab === 'live' && <Terminal lines={lines} live={live} empty={terminal.loading ? 'Reading the run output…' : terminal.error ? `Output unavailable: ${terminal.error.message}` : 'No output yet. It streams here the moment the session starts.'} label={`${keyOf(run)} output`} />}
            {tab === 'log' && <Terminal lines={lines.filter(line => line.who === 'kor' || line.who === 'jev')} live={false} empty="No daemon log lines yet." label={`${keyOf(run)} log`} />}
            {tab === 'plan' && <div {...stylex.props(styles.scroll)}>{runDecisions.filter(decision => decision.kind !== 'acceptance').map(decision => <DecisionRow key={decision.decisionId} decision={decision} />)}{runDecisions.length === 0 && <Empty title="Jev has not planned this run yet." />}</div>}
            {tab === 'decisions' && <div {...stylex.props(styles.scroll)}>{runDecisions.map(decision => <DecisionRow key={decision.decisionId} decision={decision} />)}{runDecisions.length === 0 && <Empty title="No decisions recorded for this run." />}<div><Button size="sm" variant="violet" onClick={() => navigate('linear', run.executionId)}>Open the decision panel</Button></div></div>}
            {tab === 'changes' && <div {...stylex.props(styles.scroll)}>{diffs.map(file => <DiffView key={file.path} file={file} />)}{diffs.length === 0 && <Empty title="No changes recorded yet." >The diff appears once the run reaches Verify.</Empty>}</div>}
            {tab === 'checks' && (
              <div {...stylex.props(styles.scroll)}>
                {attempt?.checks.map(check => (
                  <div key={check.command} {...stylex.props(styles.check)}>
                    <Icon icon={check.status === 'pass' ? CircleCheck : CircleX} size={14} style={check.status === 'pass' ? text.green : text.rose} />
                    <span {...stylex.props(text.mono)}>{check.command}</span>
                    <span {...stylex.props(text.mono, check.status === 'pass' ? text.green : text.rose)}>exit {check.exitCode ?? '—'}</span>
                    {check.output && <pre {...stylex.props(styles.output)}>{check.output.slice(-4000)}</pre>}
                  </div>
                ))}
                {!attempt && <Empty title="Checks run at Verify." />}
              </div>
            )}
            {supervise && tab === 'live' && (
              <div {...stylex.props(styles.notes, animate.fadeIn)}>
                <JevOrb size={26} />
                <div><b {...stylex.props(text.strong)}>Jev's notes</b> · {supervise.kind} <b {...stylex.props(text.strong)}>{supervise.choice}</b> at {prob(supervise.confidence)}{run.routeSource === 'override' ? ' (your override is in force)' : ''}. {supervise.reasons.join(' ')}</div>
              </div>
            )}
          </div>
        </div>
        <aside {...stylex.props(styles.rail)} aria-label="Run details">
          <div>
            <div {...stylex.props(layout.row)}><span {...stylex.props(text.eyebrow, text.cyan)}>Acceptance</span><span {...stylex.props(layout.grow)} /><span {...stylex.props(text.mono, text.faint, text.micro)}>{findings.filter(f => f.status !== 'pending').length} / {findings.length} judged</span></div>
            {findings.map(finding => {
              const proof = evidence.find(item => item.acceptanceId === finding.conditionId);
              return (
                <div key={finding.conditionId} {...stylex.props(styles.ac)}>
                  {finding.status === 'pass' ? <Icon icon={CircleCheck} size={14} style={text.green} /> : finding.status === 'fail' ? <Icon icon={CircleX} size={14} style={text.rose} /> : <Icon icon={CircleDashed} size={14} style={text.faint} />}
                  <span>{proof?.summary ?? finding.note ?? finding.conditionId}<span {...stylex.props(styles.acId)}>{finding.conditionId} · {finding.status}</span></span>
                </div>
              );
            })}
            {findings.length === 0 && <div {...stylex.props(styles.ac)}><span {...stylex.props(styles.pend)} /><span>Judged at Verify against Jev's threshold.</span></div>}
          </div>
          <div>
            <div {...stylex.props(text.eyebrow, text.cyan)}>Next step</div>
            <div {...stylex.props(styles.nextbox, layout.mt2)}>{step.text}</div>
          </div>
          <div {...stylex.props(styles.usage)}>
            <div {...stylex.props(styles.tile)}><b {...stylex.props(styles.tileValue)}>{usage ? compact(usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens) : '—'}</b><span {...stylex.props(styles.tileLabel)}>input tokens</span></div>
            <div {...stylex.props(styles.tile)}><b {...stylex.props(styles.tileValue)}>{usage ? compact(usage.outputTokens) : '—'}</b><span {...stylex.props(styles.tileLabel)}>output tokens</span></div>
            <div {...stylex.props(styles.tile)}><b {...stylex.props(styles.tileValue)}>{cacheRate === null ? '—' : `${Math.round(cacheRate * 100)}%`}</b><span {...stylex.props(styles.tileLabel)}>cache read</span></div>
            <div {...stylex.props(styles.tile)}><b {...stylex.props(styles.tileValue)}>{usd(run.costUsd ?? usage?.costUsd)}</b><span {...stylex.props(styles.tileLabel)}>costUsd so far</span></div>
          </div>
          {!usage && <ProvenanceChip provenance="unavailable" reason="Token usage comes from the session's own output once it starts">tokens after the session starts</ProvenanceChip>}
          <span {...stylex.props(layout.grow)} />
          <div>
            <div {...stylex.props(text.eyebrow)}>Steer</div>
            <div {...stylex.props(layout.mt2)}><TextArea label="Note for Jev" value={note} onChange={setNote} rows={3} placeholder="Note for Jev, used at the next decision…" onSubmit={sendNote} style={styles.steer} /></div>
            {error && <div {...stylex.props(layout.mt2)}><Notice title={error.message} hint={error instanceof ApiFailure ? error.hint : undefined} /></div>}
            {message.isSuccess && <div {...stylex.props(layout.mt2)}><Notice tone="ok" title="Note saved for the next decision." /></div>}
            <div {...stylex.props(layout.row, layout.mt2)}>
              <Button size="sm" icon={RotateCcw} busy={action.isPending && action.variables?.action === 'retry'} disabled={!['failed', 'blocked', 'canceled', 'escalated'].includes(run.status)} onClick={() => action.mutate({ action: 'retry', executionId: run.executionId })}>Retry</Button>
              <span {...stylex.props(layout.grow)} />
              <Button size="sm" variant="violet" icon={Send} busy={message.isPending} disabled={!note.trim() || finished} onClick={sendNote}>Send note</Button>
            </div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

type Filter = 'live' | 'queued' | 'finished';

export function Agents({ executionId, terminal = false }: { executionId?: string; terminal?: boolean }) {
  const now = useNow();
  const { runs, error } = useMissionRuns();
  const decisions = useDecisions();
  const config = useConfig();
  const [filter, setFilter] = useState<Filter>('live');
  const [queueing, setQueueing] = useState(false);
  const sorted = [...runs].sort(byAttention);
  const liveRuns = sorted.filter(run => !FINISHED.has(run.status) && run.status !== 'queued');
  const queued = sorted.filter(run => run.status === 'queued');
  const finishedToday = sorted.filter(run => FINISHED.has(run.status) && isToday(run.observedAt, now));
  const shown = filter === 'live' ? [...liveRuns, ...queued] : filter === 'queued' ? queued : finishedToday;
  const selected = runs.find(run => run.executionId === executionId) ?? liveRuns[0] ?? queued[0] ?? sorted[0];
  const limits = config.data?.config.limits;
  const used = runs.filter(isActive).length;
  return (
    <AppFrame active={terminal ? 'terminal' : 'agents'} crumbs={['Agents', selected ? keyOf(selected) : 'All']} askHint={selected ? `Ask Jev — "why did ${keyOf(selected)} pick ${shortModel(selected.route?.model)}?", "stop everything on one project"` : undefined}>
      <div {...stylex.props(page.page)}>
        <header {...stylex.props(styles.head)}>
          <div>
            <h1 {...stylex.props(page.title)}>{terminal ? 'Terminal' : 'Agents'}</h1>
            <p {...stylex.props(styles.lede)}>Every Kor run, live. Jev supervises; you stop, retry or steer.</p>
          </div>
          <span {...stylex.props(layout.grow)} />
          <Segmented value={filter} onChange={setFilter} label="Runs to show" options={[{ value: 'live', label: `Live ${liveRuns.length}` }, { value: 'queued', label: `Queued ${queued.length}` }, { value: 'finished', label: `Finished today ${finishedToday.length}` }]} />
          <div {...stylex.props(styles.slots)}>
            <span {...stylex.props(text.label)}>Slots</span>
            <span {...stylex.props(styles.pips)}>{Array.from({ length: limits?.total ?? 0 }, (_, index) => <i key={index} {...stylex.props(styles.pip, index < used && styles.pipOn)} />)}</span>
            <b {...stylex.props(text.mono)}>{used} / {limits?.total ?? '—'}</b>
            <span>{limits ? `${limits.perRepository} per repository` : ''}</span>
          </div>
          <Button variant="primary" icon={Plus} onClick={() => setQueueing(true)}>Queue an issue</Button>
        </header>
        {error && <Notice title={`Runs unavailable: ${error.message}`} />}
        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.list)}>
            {shown.map((run, index) => <AgentCard key={run.executionId} run={run} selected={run.executionId === selected?.executionId} now={now} index={index} />)}
            {shown.length === 0 && <Card pad><Empty slot="empty-no-runs" title={filter === 'finished' ? 'Nothing finished today.' : 'No runs.'}>Queue an issue to start one.</Empty></Card>}
            {filter === 'live' && finishedToday.length > 0 && (
              <Card index={shown.length} pad>
                <CardHeader icon={History} title="Finished today" count={finishedToday.length} aside={<button type="button" onClick={() => setFilter('finished')} {...stylex.props(text.violet, text.sm)}>History</button>} />
                {finishedToday.slice(0, 5).map(run => (
                  <a key={run.executionId} href={href('agents', run.executionId)} {...stylex.props(styles.finished)}>
                    <StatusPill status={run.status} small />
                    <span {...stylex.props(text.key)}>{keyOf(run)}</span>
                    <span {...stylex.props(text.ellipsis)}>{run.issueTitle}</span>
                    <span {...stylex.props(text.mono, text.xs, run.pullRequestUrl ? text.cyan : text.muted)}>{run.pullRequestUrl ? prNumber(run.pullRequestUrl) : run.status === 'failed' ? 'Retry' : ''}</span>
                  </a>
                ))}
              </Card>
            )}
          </div>
          {selected ? <RunTerminal key={selected.executionId} run={selected} decisions={decisions} now={now} /> : <Card pad><Empty slot="empty-no-runs" title="No run selected." /></Card>}
        </div>
      </div>
      {queueing && <QueueDialog onClose={() => setQueueing(false)} />}
    </AppFrame>
  );
}

