// Screen 4: the issue workspace. Issues on the left; the Linear request, Jev's
// reply, tool steps, diff, checks, acceptance and the composer in the centre;
// the Jev Decision panel on the right with approve, request changes and
// explore alternatives.
import * as stylex from '@stylexjs/stylex';
import { Check, ChevronDown, CircleCheck, CircleDashed, CircleX, GitBranch, GitPullRequest, Hash, AtSign, Play, Search, Send, Slash, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MissionRun, Project } from '@kor-code/mission-control';
import type { LinearIssue } from '@kor-code/linear';
import type { DecisionRecord } from '@kor-code/core';
import { ApiFailure } from '../api/client';
import { useDecisions, useMissionRuns } from '../api/data';
import { isOpen, issueKey, useAllIssues } from '../api/issues';
import { useLive } from '../api/live';
import { useRunTerminal } from '../api/terminal';
import { useConfig, useModels, useOverride, useProjects, useQueue, useRunAction, useRunMessage } from '../api/queries';
import { href } from '../router';
import { AppFrame } from '../shell/AppFrame';
import { initials, projectTone } from '../shell/projectTone';
import { color, font, fontSize, glow, gradient, radius, space, tint, tracking } from '../theme/tokens.stylex';
import { animate, delayBy } from '../theme/animate';
import { Button, Kbd } from '../ui/button';
import { Card } from '../ui/card';
import { Select, TextInput } from '../ui/form';
import { Priority, Tile } from '../ui/glyphs';
import { DiffView } from '../ui/diff';
import { Icon } from '../ui/icon';
import { Empty, Notice } from '../ui/misc';
import { JevOrb } from '../ui/orb';
import { Pill, ProvenanceChip, StatusPill } from '../ui/pill';
import { layout } from '../ui/layout';
import { text } from '../ui/text';
import { toneOf, toneSolid } from '../ui/tone';
import { parseDiff } from '../lib/diff';
import { parseTerminal, toolSteps } from '../lib/terminal';
import { prob, shortModel, usd } from '../lib/format';
import { byAttention, decisionsFor, FINISHED, keyOf, latestVerification, needsYou, prNumber, probabilityOf } from '../lib/runs';
import { clock, useNow } from '../lib/time';
import { nextStep } from './runText';
import { OverrideDialog } from './OverrideDialog';

const NARROW = '@media (max-width: 1499px)';

const styles = stylex.create({
  grid: { display: 'grid', gridTemplateColumns: { default: '272px minmax(0, 1fr) 348px', [NARROW]: '236px minmax(0, 1fr) 312px' }, gap: { default: space.s4, [NARROW]: '12px' }, paddingBlock: space.s4h, paddingInline: { default: '20px', [NARROW]: '16px' }, height: '100%', minHeight: '760px' },
  col: { minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  lh: { paddingBlock: `${space.s3h} ${space.s2h}`, paddingInline: space.s3h, display: 'grid', gap: space.s2h },
  projSel: { display: 'flex', alignItems: 'center', gap: space.s2h, paddingBlock: space.s1h, paddingInline: space.s2, borderRadius: radius.md, backgroundColor: color.cyanDim, borderWidth: '1px', borderStyle: 'solid', borderColor: tint.cyanEdge },
  ftabs: { display: 'flex', gap: space.s1 },
  ftab: { flex: '1', textAlign: 'center', paddingBlock: '5px', borderRadius: '7px', fontSize: fontSize.xsPlus, color: { default: color.textMuted, ':hover': color.textSecondary }, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, cursor: 'pointer', whiteSpace: 'nowrap' },
  ftabOn: { color: color.text, borderColor: tint.violetEdgeStrong, backgroundColor: tint.ptabOn },
  ftabCount: { fontFamily: font.mono, fontWeight: 500, fontSize: fontSize.microPlus, color: color.textMuted, marginLeft: '3px' },
  il: { paddingBlock: `${space.s1} ${space.s2h}`, paddingInline: space.s2, display: 'flex', flexDirection: 'column', gap: space.s0, overflowY: 'auto', flex: '1', minHeight: 0, scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  group: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: tracking.label, textTransform: 'uppercase', color: color.textFaint, paddingBlock: `${space.s3} ${space.s1h}`, paddingInline: space.s2 },
  ii: { display: 'grid', gridTemplateColumns: '8px 62px minmax(0, 1fr)', gap: '9px', alignItems: 'center', paddingBlock: space.s2, paddingInline: space.s2, borderRadius: '9px', fontSize: fontSize.smPlus, color: { default: color.textSecondary, ':hover': color.text }, cursor: 'pointer', textAlign: 'left', width: '100%' },
  iiSel: { backgroundColor: tint.ptabOn, boxShadow: `inset 0 0 0 1px ${tint.violetEdgeStrong}`, color: color.text },
  dot: { width: '7px', height: '7px', borderRadius: '50%', boxShadow: '0 0 6px currentColor' },
  history: { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: color.hairline, paddingBlock: space.s3, paddingInline: space.s3h, display: 'grid', gap: space.s2, flex: 'none' },
  ih: { paddingBlock: `${space.s4} ${space.s3h}`, paddingInline: space.s5, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline },
  h1: { fontFamily: font.display, fontSize: fontSize.headingLg, fontWeight: 600, letterSpacing: tracking.slight, marginTop: space.s1h },
  tagRow: { display: 'flex', gap: space.s1h, marginTop: space.s2h, alignItems: 'center', flexWrap: 'wrap' },
  tag: { fontFamily: font.mono, fontSize: fontSize.microPlus, paddingBlock: space.s0, paddingInline: space.s2, borderRadius: radius.sm, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairlineStrong, color: color.textSecondary, whiteSpace: 'nowrap' },
  thread: { flex: '1', minHeight: 0, overflowY: 'auto', paddingBlock: `${space.s3h} ${space.s2}`, paddingInline: space.s5, display: 'flex', flexDirection: 'column', gap: space.s3h, scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  msg: { display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr)', gap: space.s3 },
  av: { width: '30px', height: '30px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: font.display, fontWeight: 600, fontSize: fontSize.sm, backgroundImage: tint.avatar, color: color.violetBright, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairlineStrong },
  who: { fontSize: fontSize.base, fontWeight: 600, display: 'flex', gap: space.s2, alignItems: 'baseline' },
  when: { fontFamily: font.mono, fontSize: fontSize.microPlus, color: color.textFaint, fontWeight: 400 },
  txt: { marginTop: space.s1, fontSize: fontSize.basePlus, color: color.textSecondary, lineHeight: 1.55, whiteSpace: 'pre-wrap' },
  meta: { marginTop: space.s1h, fontFamily: font.mono, fontSize: fontSize.xs, color: color.textMuted },
  steps: { marginTop: space.s2, display: 'grid', gap: '1px', fontFamily: font.mono, fontSize: fontSize.xsPlus },
  step: { display: 'grid', gridTemplateColumns: '14px 52px minmax(0, 1fr) auto', gap: space.s2, alignItems: 'center', color: color.textSecondary, paddingBlock: space.s0 },
  verify: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.s2h, marginTop: space.s2h },
  vbox: { paddingBlock: space.s2h, paddingInline: space.s3, borderRadius: radius.md, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, backgroundColor: tint.ghost, minWidth: 0 },
  vrow: { display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr) auto', gap: space.s2, alignItems: 'center', fontSize: fontSize.sm, color: color.textSecondary, paddingBlock: '3px' },
  composer: { marginBlock: `${space.s3} ${space.s4}`, marginInline: space.s5, borderRadius: '13px', backgroundColor: color.surfaceSunken, boxShadow: glow.focus, paddingBlock: '11px 9px', paddingInline: `${space.s3h} ${space.s3}`, flex: 'none' },
  composerInput: { flex: '1', minWidth: 0, backgroundColor: 'transparent', borderWidth: 0, outline: 'none', color: color.text, fontSize: fontSize.md, '::placeholder': { color: color.textMuted } },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '5px', height: '24px', paddingInline: space.s2, borderRadius: '7px', fontSize: fontSize.xsPlus, color: color.textSecondary, backgroundColor: tint.ghost, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline },
  modelSelect: { height: '28px', width: '170px' },
  dh: { display: 'flex', alignItems: 'center', gap: space.s2h, paddingBlock: `${space.s3h} ${space.s3}`, paddingInline: space.s4, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline },
  panelScroll: { flex: '1', minHeight: 0, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  dsec: { paddingBlock: '11px', paddingInline: space.s4, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine },
  dEyebrow: { display: 'flex', alignItems: 'center', gap: space.s2, marginBottom: '7px', color: color.violetBright, fontFamily: font.mono, fontSize: fontSize.microPlus, letterSpacing: tracking.label, textTransform: 'uppercase' },
  dRight: { marginLeft: 'auto', color: color.textFaint, letterSpacing: tracking.brand, textTransform: 'none' },
  dP: { fontSize: fontSize.smPlus, color: color.textSecondary, lineHeight: 1.5 },
  cand: { display: 'grid', gridTemplateColumns: '82px minmax(0, 1fr) 34px', gap: space.s2, alignItems: 'center', fontFamily: font.mono, fontSize: fontSize.microPlus, color: color.textMuted, marginTop: '5px' },
  candWin: { color: color.text },
  candBar: { height: '4px', borderRadius: radius.pill, backgroundColor: tint.track, overflow: 'hidden' },
  candFill: { height: '100%', backgroundImage: gradient.progress, boxShadow: tint.barGlowCyan },
  candLose: { backgroundImage: 'none', backgroundColor: color.textMuted, boxShadow: 'none' },
  big: { fontFamily: font.display, fontSize: fontSize.figure, fontWeight: 600 },
  risk: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' },
  riskSeg: { height: '6px', borderRadius: '3px', backgroundColor: tint.stageTrack },
  riskLabels: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', fontFamily: font.mono, fontSize: fontSize.nano, color: color.textFaint, marginTop: '5px' },
  mem: { display: 'grid', gridTemplateColumns: '62px minmax(0, 1fr) 34px', gap: space.s2, fontSize: fontSize.xsPlus, color: color.textSecondary, paddingBlock: space.s0, alignItems: 'center' },
  memKind: { fontFamily: font.mono, fontSize: fontSize.nano, color: color.textFaint, textTransform: 'uppercase', letterSpacing: tracking.caps },
  approve: { display: 'flex', alignItems: 'stretch', borderRadius: '11px', overflow: 'hidden', backgroundImage: gradient.primaryButton, boxShadow: glow.button, position: 'relative' },
  approveMain: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.s2, height: '42px', fontWeight: 600, fontSize: fontSize.md, color: tint.white, cursor: 'pointer' },
  approveDrop: { width: '40px', display: 'grid', placeItems: 'center', borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: tint.violetEdgeStrong, color: tint.white, cursor: 'pointer' },
  disabled: { opacity: 0.45, cursor: 'not-allowed' },
  menu: { display: 'flex', flexDirection: 'column', gap: space.s1, marginTop: space.s1h, padding: space.s1h, borderRadius: radius.md, backgroundColor: color.surfaceRaised, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairlineStrong },
  alt: { display: 'flex', alignItems: 'center', gap: '9px', fontSize: fontSize.base, color: { default: color.textSecondary, ':hover': color.text }, paddingBlock: '7px', paddingInline: space.s1, width: '100%', cursor: 'pointer' },
  actions: { paddingBlock: space.s3h, paddingInline: space.s4, display: 'grid', gap: space.s1, flex: 'none', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: color.hairline },
  reveal: { opacity: 0 },
});
const fill = stylex.create({ w: (pct: number) => ({ width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` }) });

type Filter = 'todo' | 'active' | 'review' | 'done';
const ACTIVE_FILTER = (run: MissionRun) => needsYou(run) || !FINISHED.has(run.status) && run.status !== 'review';

const RISK_LEVELS = [/low/i, /review/i, /high|external/i];

function Section({ label, right, index, children }: { label: string; right?: React.ReactNode; index: number; children: React.ReactNode }) {
  return (
    <section {...stylex.props(styles.dsec, animate.rise, delayBy.ms(index * 70))}>
      <div {...stylex.props(styles.dEyebrow)}>{label}{right !== undefined && <span {...stylex.props(styles.dRight)}>{right}</span>}</div>
      {children}
    </section>
  );
}

function DecisionPanel({ run, decisions, issue, onRequestChanges }: { run: MissionRun; decisions: DecisionRecord[]; issue: LinearIssue | undefined; onRequestChanges: () => void }) {
  const [menu, setMenu] = useState(false);
  const [exploring, setExploring] = useState(false);
  const action = useRunAction();
  const decidedAt = useLive(live => live.decidedAt[run.executionId] ?? 0);
  const now = useNow();
  const kind = (name: string) => [...decisions].reverse().find(decision => decision.kind === name);
  const route = kind('route'), risk = kind('risk'), skill = kind('skill'), agent = kind('agent'), context = kind('context');
  const escalated = decisions.filter(decision => decision.escalated).length;
  // Confidence belongs only to the choice it was recorded for: Jev's own route, in force as Jev chose it.
  const jevChoseRoute = route !== undefined && run.routeSource === 'jev' && run.route?.model === route.choice;
  const policy = route?.policyChecks ?? [];
  const canApprove = run.status === 'waiting';
  const canRetry = ['failed', 'blocked', 'canceled', 'escalated'].includes(run.status);
  const riskIndex = risk ? RISK_LEVELS.findIndex(pattern => pattern.test(risk.choice)) : -1;
  const step = nextStep(run);
  const error = action.error;
  const deciding = decidedAt > 0 && now - decidedAt < 2_500;
  // R requests changes and E explores alternatives, as the panel's key hints say; typing in a field is left alone.
  const shortcuts = (node: HTMLElement | null) => {
    if (!node) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (event.key === 'r' || event.key === 'R') { event.preventDefault(); onRequestChanges(); }
      else if (event.key === 'e' || event.key === 'E') { event.preventDefault(); setExploring(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  };
  return (
    <Card index={2} variant="neon" flex style={styles.col} label="Jev decision">
      <span ref={shortcuts} hidden />
      <div {...stylex.props(styles.dh)}>
        <JevOrb size={34} state={run.status === 'evaluating' ? 'thinking' : deciding ? 'deciding' : 'idle'} playKey={decidedAt} />
        <div>
          <div {...stylex.props(text.eyebrow, text.violet)}>Jev decision</div>
          <div {...stylex.props(text.mono, text.faint, text.xs)}>{decisions.length} decisions · {escalated} escalated</div>
        </div>
        <span {...stylex.props(layout.grow)} />
        <ProvenanceChip provenance="live" />
      </div>
      <div {...stylex.props(styles.panelScroll)}>
        <Section index={0} label="Intent" right="from Linear"><p {...stylex.props(styles.dP)}>{issue?.description?.split('\n').find(line => line.trim())?.slice(0, 280) ?? run.issueTitle ?? run.issueId}</p></Section>
        <Section index={1} label="Chosen model" right={`route · ${run.routeSource ?? '—'}`}>
          <div {...stylex.props(layout.row)}>
            <div {...stylex.props(layout.grow)}>
              <div {...stylex.props(text.strong, text.md)}>{run.route?.model ?? 'not routed yet'}</div>
              <div {...stylex.props(text.mono, text.muted, text.micro)}>{run.accountSlot.value ?? 'slot unreported'}{run.route?.reasoningLevel ? ` · ${run.route.reasoningLevel} reasoning` : ''}</div>
            </div>
            {jevChoseRoute && route && <span {...stylex.props(styles.big)}>{prob(route.confidence)}</span>}
            {run.routeSource === 'override' && <Pill tone="magenta" small dot>your override</Pill>}
            {run.routeSource === 'config' || run.routeSource === 'fallback' ? <Pill tone="slate" small>{run.routeSource === 'config' ? 'configured default' : 'fallback'}</Pill> : null}
          </div>
          {route && !jevChoseRoute && (
            <p {...stylex.props(styles.dP, layout.mt2)}>
              {run.routeSource === 'override' ? 'You chose this route; it carries no Jev confidence. ' : 'This route did not come from the Jev decision below. '}
              Jev's recorded route decision was <b {...stylex.props(text.strong)}>{route.choice}</b> at {prob(route.confidence)}:
            </p>
          )}
          {route?.candidates.map(candidate => {
            const win = candidate === route.choice;
            const p = probabilityOf(route, candidate);
            return (
              <div key={candidate} {...stylex.props(styles.cand, win && styles.candWin)}>
                <span {...stylex.props(text.ellipsis)}>{shortModel(candidate)}</span>
                <div {...stylex.props(styles.candBar)}>{p !== undefined && <div {...stylex.props(styles.candFill, animate.grow, delayBy.ms(win ? 420 : 240), fill.w(p), !win && styles.candLose)} />}</div>
                <span>{prob(p)}</span>
              </div>
            );
          })}
        </Section>
        {route && <Section index={2} label={jevChoseRoute ? 'Why' : 'Why Jev recommended its route'}><p {...stylex.props(styles.dP)}>{route.reasons.join(' ')}</p></Section>}
        {risk && (
          <Section index={3} label="Risk" right={`${risk.choice} · ${prob(risk.confidence)}`}>
            <div {...stylex.props(styles.risk)}>{[0, 1, 2].map(level => <i key={level} {...stylex.props(styles.riskSeg, level <= riskIndex && toneSolid[level === 0 ? 'green' : level === 1 ? 'amber' : 'rose'])} />)}</div>
            <div {...stylex.props(styles.riskLabels)}><span>low</span><span>review required</span><span>high or external</span></div>
          </Section>
        )}
        {(skill || agent) && (
          <Section index={4} label="Skill and agent">
            {[['skill', skill], ['agent', agent]].map(([name, decision]) => decision && typeof decision !== 'string' && (
              <div key={name as string} {...stylex.props(styles.mem)}>
                <span {...stylex.props(styles.memKind)}>{name as string}</span>
                <span {...stylex.props(text.ellipsis)}>{decision.choice}{decision.candidates.filter(one => one !== decision.choice).length > 0 && <span {...stylex.props(text.muted)}> · over {decision.candidates.filter(one => one !== decision.choice).join(', ')}</span>}</span>
                <span {...stylex.props(text.mono, text.right)}>{prob(decision.confidence)}</span>
              </div>
            ))}
          </Section>
        )}
        {context && (
          <Section index={5} label="Memory" right={context.choice}>
            {context.inputs.slice(0, 4).map(input => (
              <div key={input.name} {...stylex.props(styles.mem)}>
                <span {...stylex.props(styles.memKind)}>{input.source ?? 'input'}</span>
                <span {...stylex.props(text.ellipsis)}>{input.name}</span>
                <span {...stylex.props(text.mono, text.muted, text.right)}>{typeof input.value === 'number' ? prob(input.value) : ''}</span>
              </div>
            ))}
            {context.inputs.length === 0 && <p {...stylex.props(styles.dP)}>{context.reasons.join(' ')}</p>}
          </Section>
        )}
        {policy.length > 0 && (
          <Section index={6} label="Policy checks" right={policy.every(check => check.result === 'pass') ? 'all pass' : `${policy.filter(check => check.result !== 'pass').length} open`}>
            <div {...stylex.props(layout.rowWrap)}>{policy.map(check => <Pill key={check.name} tone={check.result === 'pass' ? 'green' : check.result === 'fail' ? 'rose' : 'amber'} small>{check.name}</Pill>)}</div>
          </Section>
        )}
        <Section index={7} label="Next step"><p {...stylex.props(styles.dP)}>{step.text}</p></Section>
        {decisions.length === 0 && <Empty title="Jev has not decided anything for this run yet." />}
      </div>
      <div {...stylex.props(styles.actions)}>
        {error && <Notice title={error.message} hint={error instanceof ApiFailure ? error.hint : undefined} />}
        {canRetry ? <Button variant="primary" icon={Play} busy={action.isPending} onClick={() => action.mutate({ action: 'retry', executionId: run.executionId })}>Retry the run</Button> : <div {...stylex.props(styles.approve, !canApprove && styles.disabled)}>
          <button type="button" disabled={!canApprove || action.isPending} title={canApprove ? 'Commit, run the delivery gate and open the pull request' : 'Approve is available once the run has verified and waits for you'} onClick={() => action.mutate({ action: 'approve', executionId: run.executionId })} {...stylex.props(styles.approveMain)}>
            <Icon icon={Check} size={16} />{action.isPending && action.variables?.action === 'approve' ? 'Approving…' : 'Approve and ship'}
          </button>
          <button type="button" aria-label="More ship options" aria-expanded={menu} onClick={() => setMenu(open => !open)} {...stylex.props(styles.approveDrop)}><Icon icon={ChevronDown} size={16} /></button>
        </div>}
        {menu && (
          <div {...stylex.props(styles.menu, animate.fadeInFast)}>
            {run.pullRequestUrl && <Button size="sm" variant="ghost" icon={GitPullRequest} href={run.pullRequestUrl} external>Open {prNumber(run.pullRequestUrl)}</Button>}
            {['failed', 'blocked', 'canceled', 'escalated'].includes(run.status) && <Button size="sm" variant="ghost" icon={Play} onClick={() => action.mutate({ action: 'retry', executionId: run.executionId })}>Retry the run</Button>}
            {!FINISHED.has(run.status) && <Button size="sm" variant="danger-ghost" icon={Square} onClick={() => action.mutate({ action: 'cancel', executionId: run.executionId })}>Cancel the run</Button>}
          </div>
        )}
        <button type="button" onClick={onRequestChanges} {...stylex.props(styles.alt)}><Icon icon={Send} size={15} />Request changes<span {...stylex.props(layout.mlAuto)}><Kbd>R</Kbd></span></button>
        <button type="button" onClick={() => setExploring(true)} {...stylex.props(styles.alt)}><Icon icon={GitBranch} size={15} />Explore alternatives<span {...stylex.props(layout.mlAuto)}><Kbd>E</Kbd></span></button>
      </div>
      {exploring && <OverrideDialog run={run} decisions={decisions} onClose={() => setExploring(false)} />}
    </Card>
  );
}

function Workspace({ run, issue, decisions, composerRef }: { run: MissionRun; issue: LinearIssue | undefined; decisions: DecisionRecord[]; composerRef: React.RefObject<HTMLInputElement | null> }) {
  const terminal = useRunTerminal(run.executionId);
  const models = useModels();
  const message = useRunMessage();
  const override = useOverride();
  const [draft, setDraft] = useState('');
  // null follows the route in force (it changes when an override applies); a pick here is kept until sent.
  const [picked, setModel] = useState<string | null>(null);
  const model = picked ?? run.route?.model ?? '';
  const steps = toolSteps(parseTerminal(terminal.text)).slice(-8);
  const attempt = latestVerification(run);
  const diffs = attempt ? parseDiff(attempt.diff) : [];
  const readiness = [...decisions].reverse().find(decision => decision.kind === 'readiness');
  const complexity = [...decisions].reverse().find(decision => decision.kind === 'complexity');
  const risk = [...decisions].reverse().find(decision => decision.kind === 'risk');
  const skill = [...decisions].reverse().find(decision => decision.kind === 'skill');
  const verified = (models.data?.models.value ?? []).filter(one => one.compatibility === 'verified').map(one => one.id);
  const modelOptions = [...new Set([run.route?.model, ...verified].filter((one): one is string => Boolean(one)))].map(value => ({ value, label: shortModel(value) }));
  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    if (model && model !== run.route?.model) await override.mutateAsync({ executionId: run.executionId, target: 'route', choice: model }).catch(() => undefined);
    message.mutate({ action: 'request-changes', executionId: run.executionId, body: { message: text } }, { onSuccess: () => { setDraft(''); setModel(null); } });
  };
  const error = message.error ?? override.error;
  const tags = [issue?.stateName ?? run.issueState, ...(issue?.labels ?? [])].filter(Boolean) as string[];
  return (
    <Card index={1} flex style={styles.col} label={`${keyOf(run)} workspace`}>
      <header {...stylex.props(styles.ih)}>
        <div {...stylex.props(layout.row)}>
          <span {...stylex.props(text.key)}>{keyOf(run)}</span>
          <span {...stylex.props(layout.grow)} />
          {run.pullRequestUrl && <a href={run.pullRequestUrl} target="_blank" rel="noopener noreferrer" {...stylex.props(text.cyan, text.sm)}>{prNumber(run.pullRequestUrl)} ↗</a>}
          {(run.issueUrl ?? issue?.url) && <a href={run.issueUrl ?? issue?.url} target="_blank" rel="noopener noreferrer" {...stylex.props(text.cyan, text.sm)}>Open in Linear ↗</a>}
        </div>
        <h1 {...stylex.props(styles.h1)}>{run.issueTitle ?? issue?.title ?? run.issueId}</h1>
        <div {...stylex.props(styles.tagRow)}>
          {issue && issue.priority > 0 && <span {...stylex.props(styles.tag, layout.row)}><Priority value={issue.priority} />{['', 'Urgent', 'High', 'Medium', 'Low'][issue.priority]}</span>}
          <StatusPill status={run.status} detail={`kor · ${run.stage}`} small />
          {tags.map(tag => <span key={tag} {...stylex.props(styles.tag)}>{tag}</span>)}
        </div>
      </header>
      <div {...stylex.props(styles.thread)}>
        <div {...stylex.props(styles.msg)}>
          <span {...stylex.props(styles.av)}>L</span>
          <div>
            <div {...stylex.props(styles.who)}>Linear issue <span {...stylex.props(styles.when)}>{issue ? issueKey(issue) : ''}</span></div>
            <div {...stylex.props(styles.txt)}>{issue?.description?.trim() || run.issueTitle || 'The issue description has not been read yet.'}</div>
            <div {...stylex.props(styles.meta)}>{issue ? `${issue.acceptanceCriteria.length} acceptance criteria · labels ${issue.labels.join(', ') || 'none'}` : 'reading Linear…'}</div>
          </div>
        </div>
        {(readiness || run.route) && (
          <div {...stylex.props(styles.msg, animate.fadeIn)}>
            <JevOrb size={30} />
            <div>
              <div {...stylex.props(styles.who)}>Jev <span {...stylex.props(styles.when)}>{readiness ? clock(readiness.recordedAt) : ''} · {run.route?.model ?? '—'} · {run.accountSlot.value ?? 'slot unreported'}</span></div>
              <div {...stylex.props(styles.txt)}>
                {readiness && <>Readiness <b {...stylex.props(text.strong)}>{readiness.choice}</b> at <b {...stylex.props(text.strong)}>{prob(readiness.confidence)}</b>. </>}
                {complexity && <>Complexity {complexity.choice}. </>}
                {risk && <>Risk {risk.choice}. </>}
                {run.route && <>Routed to <b {...stylex.props(text.strong)}>{shortModel(run.route.model)}</b>{run.routeSource ? ` (${run.routeSource})` : ''}{skill ? <> with the <b {...stylex.props(text.strong)}>{skill.choice}</b> skill</> : null}.</>}
              </div>
              {steps.length > 0 && (
                <div {...stylex.props(styles.steps)}>
                  {steps.map(step => <div key={step.key} {...stylex.props(styles.step)}><span {...stylex.props(text.faint)}>›</span><span {...stylex.props(text.cyan)}>{step.who}</span><span {...stylex.props(text.ellipsis)}>{step.body}</span><span {...stylex.props(text.faint)}>{step.time}</span></div>)}
                </div>
              )}
            </div>
          </div>
        )}
        {diffs.slice(0, 2).map(file => <DiffView key={file.path} file={file} maxLines={60} />)}
        {attempt && (
          <div {...stylex.props(styles.verify)}>
            <div {...stylex.props(styles.vbox)}>
              <div {...stylex.props(layout.row, layout.mt1)}><span {...stylex.props(text.eyebrow, text.cyan)}>Checks</span><span {...stylex.props(layout.grow)} /><Pill tone={attempt.checks.every(check => check.status === 'pass') ? 'green' : 'rose'} small>{attempt.checks.filter(check => check.status === 'pass').length} / {attempt.checks.length}</Pill></div>
              {attempt.checks.map(check => (
                <div key={check.command} {...stylex.props(styles.vrow)}>
                  <Icon icon={check.status === 'pass' ? CircleCheck : CircleX} size={14} style={check.status === 'pass' ? text.green : text.rose} />
                  <span {...stylex.props(text.mono, text.ellipsis)}>{check.command}</span>
                  <span {...stylex.props(text.mono, text.xs, check.status === 'pass' ? text.green : text.rose)}>exit {check.exitCode ?? '—'}</span>
                </div>
              ))}
              {attempt.checks.length === 0 && <span {...stylex.props(text.muted, text.sm)}>No repository checks configured.</span>}
            </div>
            <div {...stylex.props(styles.vbox)}>
              <div {...stylex.props(layout.row, layout.mt1)}><span {...stylex.props(text.eyebrow, text.cyan)}>Acceptance · Jev</span></div>
              {attempt.findings.map(finding => {
                const proof = attempt.evidence.find(item => item.acceptanceId === finding.conditionId);
                return (
                  <div key={finding.conditionId} {...stylex.props(styles.vrow)}>
                    <Icon icon={finding.status === 'pass' ? CircleCheck : finding.status === 'fail' ? CircleX : CircleDashed} size={14} style={finding.status === 'pass' ? text.green : finding.status === 'fail' ? text.rose : text.faint} />
                    <span {...stylex.props(text.ellipsis)} title={proof?.summary ?? finding.note}>{proof?.summary ?? finding.note ?? finding.conditionId}</span>
                    <span {...stylex.props(text.mono, text.xs, finding.status === 'pass' ? text.green : finding.status === 'fail' ? text.rose : text.muted)}>{finding.status}</span>
                  </div>
                );
              })}
              {attempt.findings.length === 0 && <span {...stylex.props(text.muted, text.sm)}>No acceptance findings recorded.</span>}
            </div>
          </div>
        )}
      </div>
      <form {...stylex.props(styles.composer)} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div {...stylex.props(layout.row)}>
          <JevOrb size={18} state={message.isPending ? 'thinking' : 'idle'} />
          <input ref={composerRef} aria-label="Request changes" value={draft} onChange={event => setDraft(event.target.value)} placeholder={FINISHED.has(run.status) ? 'This run has finished.' : 'Request changes, e.g. "cap each batch by payload size too"'} {...stylex.props(styles.composerInput)} />
        </div>
        {error && <div {...stylex.props(layout.mt2)}><Notice title={error.message} hint={error instanceof ApiFailure ? error.hint : undefined} /></div>}
        {message.isSuccess && <div {...stylex.props(layout.mt2)}><Notice tone="ok" title="Changes requested. The run goes back through Execute and Verify." /></div>}
        <div {...stylex.props(layout.row, layout.mt2)}>
          <button type="button" onClick={() => setDraft(value => `${value}@`)} {...stylex.props(styles.chip)}><Icon icon={AtSign} size={12} />File</button>
          <button type="button" onClick={() => setDraft(value => `${value}#`)} {...stylex.props(styles.chip)}><Icon icon={Hash} size={12} />Issue</button>
          <button type="button" onClick={() => setDraft(value => `${value}/`)} {...stylex.props(styles.chip)}><Icon icon={Slash} size={12} />Command</button>
          <span {...stylex.props(layout.grow)} />
          <span {...stylex.props(text.mono, text.violet, text.xs)}>→ Request changes</span>
          {modelOptions.length > 0 && <Select label="Model for the next attempt" value={model} onChange={setModel} options={modelOptions} style={styles.modelSelect} />}
          <Button variant="primary" size="sm" iconOnly icon={Send} type="submit" label="Send" busy={message.isPending} disabled={!draft.trim()} />
        </div>
      </form>
    </Card>
  );
}

export function JevDecision({ executionId }: { executionId?: string }) {
  const { runs } = useMissionRuns();
  const decisions = useDecisions();
  const projects = useProjects();
  const config = useConfig();
  const queue = useQueue();
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const projectList = projects.data?.projects ?? [];
  const selected = runs.find(run => run.executionId === executionId || run.issueKey === executionId) ?? [...runs].sort(byAttention)[0];
  const project: Project | undefined = projectList.find(one => one.id === (projectId ?? selected?.repository)) ?? projectList.find(one => one.runs.some(run => run.executionId === selected?.executionId)) ?? projectList[0];
  const issues = useAllIssues(project ? [project] : []);
  const projectIssues = issues[0]?.issues ?? [];
  const issue = selected ? projectIssues.find(one => one.id === selected.issueId) : undefined;
  const projectRuns = (project ? runs.filter(run => project.runs.some(one => one.executionId === run.executionId)) : runs);
  const needle = search.trim().toLowerCase();
  const match = (key: string, title: string) => !needle || `${key} ${title}`.toLowerCase().includes(needle);
  const active = projectRuns.filter(ACTIVE_FILTER).filter(run => match(keyOf(run), run.issueTitle ?? ''));
  const review = projectRuns.filter(run => run.status === 'review').filter(run => match(keyOf(run), run.issueTitle ?? ''));
  const done = projectRuns.filter(run => run.status === 'complete' || run.status === 'canceled').filter(run => match(keyOf(run), run.issueTitle ?? ''));
  const intake = config.data?.config.intakeLabel ?? 'kor';
  const runIssues = new Set(runs.map(run => run.issueId));
  const ready = projectIssues.filter(one => isOpen(one) && !runIssues.has(one.id) && one.labels.includes(intake)).filter(one => match(issueKey(one), one.title));
  const runDecisions = selected ? decisionsFor(decisions, selected.executionId) : [];
  const projectIndex = project ? projectList.indexOf(project) : 0;
  const runItem = (run: MissionRun) => (
    <a key={run.executionId} href={href('linear', run.executionId)} aria-current={run.executionId === selected?.executionId ? 'true' : undefined} {...stylex.props(styles.ii, run.executionId === selected?.executionId && styles.iiSel)}>
      <span {...stylex.props(styles.dot, toneSolid[toneOf(run.status)])} />
      <span {...stylex.props(text.key)}>{keyOf(run)}</span>
      <span {...stylex.props(text.ellipsis)}>{run.issueTitle}</span>
    </a>
  );
  return (
    <AppFrame active="linear" crumbs={[project?.name ?? 'Linear', selected ? keyOf(selected) : 'Issues']} askHint={selected ? `Ask Jev about ${keyOf(selected)} — "why ${shortModel(selected.route?.model)}?", "what would another model change?"` : undefined}>
      <div {...stylex.props(styles.grid)}>
        <Card index={0} flex style={styles.col} label="Issues">
          <div {...stylex.props(styles.lh)}>
            <div {...stylex.props(styles.projSel)}>
              <Tile tone={projectTone(projectIndex)}>{initials(project?.name ?? '—')}</Tile>
              <Select label="Project" value={project?.id ?? ''} onChange={value => setProjectId(value)} options={projectList.map(one => ({ value: one.id, label: one.name }))} style={layout.grow} />
            </div>
            <TextInput label="Search issues" icon={Search} value={search} onChange={setSearch} placeholder="Search issues…" />
            <div {...stylex.props(styles.ftabs)} role="tablist">
              {([['todo', 'Todo', ready.length], ['active', 'Active', active.length], ['review', 'Review', review.length], ['done', 'Done', done.length]] as const).map(([value, label, count]) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} {...stylex.props(styles.ftab, filter === value && styles.ftabOn)}>{label}<b {...stylex.props(styles.ftabCount)}>{count}</b></button>
              ))}
            </div>
          </div>
          <div {...stylex.props(styles.il)}>
            {filter === 'active' && <>{active.map(runItem)}{active.length === 0 && <span {...stylex.props(styles.group)}>nothing active</span>}{review.length > 0 && <><div {...stylex.props(styles.group)}>In review</div>{review.map(runItem)}</>}</>}
            {filter === 'review' && review.map(runItem)}
            {filter === 'done' && done.map(runItem)}
            {(filter === 'todo' || filter === 'active') && ready.length > 0 && (
              <>
                <div {...stylex.props(styles.group)}>Ready for Kor</div>
                {ready.slice(0, 20).map(one => (
                  <div key={one.id} {...stylex.props(styles.ii)}>
                    <span {...stylex.props(styles.dot, toneSolid.sky)} />
                    <span {...stylex.props(text.key)}>{issueKey(one)}</span>
                    <span {...stylex.props(layout.row)}><span {...stylex.props(text.ellipsis, layout.grow)}>{one.title}</span><Button size="sm" variant="ghost" iconOnly icon={Play} label={`Run ${issueKey(one)} with Kor`} busy={queue.isPending && queue.variables?.issueIds.includes(one.id)} onClick={() => queue.mutate({ issueIds: [one.id] })} /></span>
                  </div>
                ))}
              </>
            )}
          </div>
          {queue.error && <div {...stylex.props(styles.lh)}><Notice title={queue.error.message} hint={queue.error instanceof ApiFailure ? queue.error.hint : undefined} /></div>}
          {selected && (
            <div {...stylex.props(styles.history)}>
              <div {...stylex.props(layout.row)}><span {...stylex.props(text.label)}>Run history</span><span {...stylex.props(layout.grow)} /><span {...stylex.props(text.mono, text.faint, text.micro)}>{keyOf(selected)}</span></div>
              {(selected.verification?.attempts ?? []).map(one => (
                <div key={one.attemptId ?? one.attempt} {...stylex.props(layout.row, text.sm)}>
                  <Pill tone="violet" small dot>attempt {one.attempt}</Pill>
                  <span {...stylex.props(text.mono, text.secondary)}>{one.checks.every(check => check.status === 'pass') && one.findings.every(finding => finding.status === 'pass') ? 'verified' : `${one.blockers.length} blockers`}</span>
                </div>
              ))}
              <div {...stylex.props(layout.row, text.sm)}><Pill tone="ghost" small dot>jev</Pill><span {...stylex.props(text.mono, text.muted)}>{runDecisions.length} decisions · {runDecisions.filter(one => one.escalated).length} escalated · {usd(selected.costUsd)}</span></div>
            </div>
          )}
        </Card>
        {selected ? (
          <>
            <Workspace key={`w-${selected.executionId}`} run={selected} issue={issue} decisions={runDecisions} composerRef={composerRef} />
            <DecisionPanel key={`d-${selected.executionId}`} run={selected} decisions={runDecisions} issue={issue} onRequestChanges={() => composerRef.current?.focus()} />
          </>
        ) : (
          <Card index={1} pad style={styles.col}><Empty slot="empty-no-runs" title="No Kor runs yet.">Start an issue from the list on the left, or from Home.</Empty></Card>
        )}
      </div>
    </AppFrame>
  );
}

