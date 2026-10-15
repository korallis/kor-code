// Screen 2: one project's workspace. Linear issues with their Kor run, bulk
// queueing, progress, health, pull requests, activity and repository settings.
import * as stylex from '@stylexjs/stylex';
import { Activity as ActivityIcon, BookOpen, Check, CircleAlert, CircleCheck, Coins, FileText, FolderKanban, Funnel, GitBranch, GitPullRequest, Layers, ListChecks, Play, Plus, RotateCcw, Route as RouteIcon, Search, Settings as SettingsIcon, ShieldCheck, Sparkles, Square, Timer, Users } from 'lucide-react';
import { useState } from 'react';
import type { MissionRun, Project } from '@kor-code/mission-control';
import type { LinearIssue } from '@kor-code/linear';
import type { KorConfig } from '@kor-code/config';
import { ApiFailure } from '../api/client';
import { useMissionRuns, useOverrides, useDecisions } from '../api/data';
import { isOpen, issueKey, useAllIssues } from '../api/issues';
import { useConfig, useProjects, usePulls, useQueue, useRunAction, useSaveProject } from '../api/queries';
import { href, navigate } from '../router';
import { AppFrame } from '../shell/AppFrame';
import { openAsk } from '../shell/askStore';
import { initials, projectTone } from '../shell/projectTone';
import { color, font, fontSize, glow, gradient, space, tint, tracking } from '../theme/tokens.stylex';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Ring, Spark } from '../ui/charts';
import { Checkbox, FieldLabel, Segmented, TextArea, TextInput } from '../ui/form';
import { BrandMark, Icon } from '../ui/icon';
import { LinearState, linearStateKind, Priority } from '../ui/glyphs';
import { Empty, Feed, FeedItem, Notice } from '../ui/misc';
import { Pill, ProvenanceChip, StatusPill } from '../ui/pill';
import { StageTrack } from '../ui/stages';
import { Table, Td, Th, Tr } from '../ui/table';
import { PillTabs, Tabs } from '../ui/tabs';
import { layout } from '../ui/layout';
import { text } from '../ui/text';
import { buildActivity } from '../lib/activity';
import { prob, shortModel, usd } from '../lib/format';
import { FINISHED, isActive, keyOf, needsYou, prNumber, latestDecision, runUpdatedAt } from '../lib/runs';
import { ago, shortDate, useNow } from '../lib/time';
import { page, QueryError } from './shared';

// config.yaml's default per-turn guidance budget for a repository.
const DEFAULT_SKILL_BUDGET = 4_000;

const NARROW = '@media (max-width: 1499px)';

const styles = stylex.create({
  head: { display: 'flex', alignItems: 'center', gap: space.s4h, paddingBlock: space.s4h, paddingInline: space.s5, overflow: 'hidden', flexWrap: 'wrap' },
  halo: { position: 'absolute', right: '80px', top: '-120px', width: '420px', height: '300px', backgroundImage: tint.cyanHalo, pointerEvents: 'none' },
  logo: { width: '60px', height: '60px', borderRadius: '17px', display: 'grid', placeItems: 'center', fontFamily: font.display, fontWeight: 700, fontSize: fontSize.figure, color: tint.white, backgroundImage: gradient.brandDiagonal, boxShadow: `0 0 0 1px ${tint.cyanEdge}, ${glow.cyan}`, flex: 'none' },
  h1: { fontFamily: font.display, fontSize: fontSize.page, fontWeight: 600, letterSpacing: tracking.snug, lineHeight: 1.1, display: 'flex', alignItems: 'center', gap: space.s3 },
  meta: { display: 'flex', alignItems: 'center', gap: space.s3h, marginTop: '7px', fontFamily: font.mono, fontSize: fontSize.xsPlus, color: color.textMuted, flexWrap: 'wrap' },
  metaItem: { display: 'inline-flex', alignItems: 'center', gap: space.s1h, whiteSpace: 'nowrap' },
  body: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) 404px', [NARROW]: 'minmax(0, 1fr) 340px' }, gap: space.s4, alignItems: 'start' },
  toolbar: { display: 'flex', alignItems: 'center', gap: space.s2h, paddingBlock: space.s3h, paddingInline: space.s4h, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline, flexWrap: 'wrap' },
  tableWrap: { paddingInline: space.s2, overflowX: 'auto' },
  title: { maxWidth: '236px' },
  korCell: { display: 'grid', gap: '5px', width: '150px' },
  mdl: { fontFamily: font.mono, fontSize: fontSize.xsPlus, color: color.textSecondary, lineHeight: 1.35 },
  mdlSub: { color: color.textMuted, fontSize: fontSize.microPlus },
  selbar: { display: 'flex', alignItems: 'center', gap: space.s2h, marginBlock: space.s2h, marginInline: space.s4h, paddingBlock: space.s2, paddingInline: space.s3, borderRadius: '12px', borderWidth: '1px', borderStyle: 'solid', borderColor: tint.violetEdgeStrong, backgroundColor: tint.violetSoftFill, flexWrap: 'wrap' },
  foot: { display: 'flex', alignItems: 'center', paddingBlock: `${space.s2h} ${space.s3h}`, paddingInline: space.s4h, fontFamily: font.mono, fontSize: fontSize.xs, color: color.textMuted },
  side: { display: 'flex', flexDirection: 'column', gap: space.s4, minWidth: 0 },
  bigPct: { fontFamily: font.display, fontSize: fontSize.heroNarrow, fontWeight: 600, lineHeight: 1, letterSpacing: tracking.tight },
  stats4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: space.s2, marginTop: space.s3 },
  stat: { paddingLeft: space.s2h, borderLeftWidth: '2px', borderLeftStyle: 'solid' },
  statValue: { display: 'block', fontFamily: font.display, fontSize: fontSize.xl, fontWeight: 600 },
  statLabel: { fontSize: fontSize.xs, color: color.textMuted },
  health: { display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: space.s4, alignItems: 'center' },
  grade: { fontFamily: font.display, fontSize: fontSize.figureLg, fontWeight: 700 },
  hl: { display: 'grid', gap: space.s1h, fontSize: fontSize.smPlus, color: color.textSecondary },
  hlRow: { display: 'flex', gap: space.s2, alignItems: 'center' },
  hlVal: { marginLeft: 'auto', fontFamily: font.mono, fontSize: fontSize.xsPlus, color: color.text, fontWeight: 500 },
  pr: { display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) auto', gap: space.s2h, alignItems: 'center', paddingBlock: space.s2, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine },
  prTitle: { fontSize: fontSize.base, fontWeight: 500 },
  prSub: { fontFamily: font.mono, fontSize: fontSize.microPlus, color: color.textMuted, marginTop: space.s0 },
  edgeViolet: { borderLeftColor: color.violetBright }, edgeGreen: { borderLeftColor: color.green }, edgeAmber: { borderLeftColor: color.amber }, edgeSlate: { borderLeftColor: color.slate },
  form: { display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: `${space.s3h} ${space.s4h}`, alignItems: 'start', padding: space.s5, maxWidth: '920px' },
  doc: { display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: space.s2h, paddingBlock: space.s2h, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, alignItems: 'start' },
  docBody: { fontSize: fontSize.smPlus, color: color.textMuted, whiteSpace: 'pre-wrap', maxHeight: '64px', overflow: 'hidden', marginTop: space.s1 },
});

type Tab = 'overview' | 'issues' | 'runs' | 'pulls' | 'documents' | 'settings';
type Filter = 'all' | 'kor' | 'running' | 'needs' | 'ready';

function runFor(issue: LinearIssue, runs: readonly MissionRun[]): MissionRun | undefined {
  return runs.filter(run => run.issueId === issue.id).sort((a, b) => (Date.parse(runUpdatedAt(b) ?? '') || 0) - (Date.parse(runUpdatedAt(a) ?? '') || 0))[0];
}

function IssueAction({ issue, run, intake, selected }: { issue: LinearIssue; run: MissionRun | undefined; intake: string; selected: boolean }) {
  const queue = useQueue();
  const action = useRunAction();
  const error = queue.error ?? action.error;
  const title = error ? `${error.message}${error instanceof ApiFailure ? ` ${error.hint}` : ''}` : undefined;
  if (run?.status === 'waiting') return <Button size="sm" variant="primary" onClick={() => navigate('linear', run.executionId)}>Review</Button>;
  if (run && isActive(run)) return <Button size="sm" variant="danger" icon={Square} title={title} busy={action.isPending} onClick={() => action.mutate({ action: 'cancel', executionId: run.executionId })}>Stop</Button>;
  if (run && (run.status === 'failed' || run.status === 'canceled' || run.status === 'blocked' || run.status === 'escalated')) return <Button size="sm" icon={RotateCcw} title={title} busy={action.isPending} onClick={() => action.mutate({ action: 'retry', executionId: run.executionId })}>Retry</Button>;
  if (run?.pullRequestUrl) return <a href={run.pullRequestUrl} target="_blank" rel="noopener noreferrer" {...stylex.props(text.cyan, text.mono, text.sm)}>{prNumber(run.pullRequestUrl)}</a>;
  if (run?.status === 'queued') return <Pill tone="slate" small dot>queued</Pill>;
  if (!isOpen(issue)) return null;
  if (issue.acceptanceCriteria.length === 0) return <Button size="sm" variant="warn" icon={Plus} href={issue.url} external title="Add acceptance criteria in Linear">Add criteria</Button>;
  if (!issue.labels.includes(intake)) return <Button size="sm" variant="ghost" icon={Plus} href={issue.url} external title={`Label the issue ${intake} in Linear so the daemon picks it up`}>Label</Button>;
  return <Button size="sm" variant={selected ? 'violet' : 'default'} icon={Play} title={title} busy={queue.isPending} onClick={() => queue.mutate({ issueIds: [issue.id] })}>Run with Kor</Button>;
}

function IssuesTable({ issues, runs, intake, selected, setSelected, filter }: { issues: readonly LinearIssue[]; runs: readonly MissionRun[]; intake: string; selected: readonly string[]; setSelected: (ids: readonly string[]) => void; filter: Filter }) {
  const decisions = useDecisions();
  const rows = issues.map(issue => ({ issue, run: runFor(issue, runs) }))
    .filter(({ issue, run }) => filter === 'all' || (filter === 'kor' && issue.labels.includes(intake)) || (filter === 'running' && run && isActive(run)) || (filter === 'needs' && run && (needsYou(run) || run.status === 'waiting')) || (filter === 'ready' && !run && isOpen(issue) && issue.labels.includes(intake) && issue.acceptanceCriteria.length > 0))
    .sort((a, b) => (a.run ? 0 : 1) - (b.run ? 0 : 1) || (a.issue.priority || 5) - (b.issue.priority || 5));
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter(one => one !== id) : [...selected, id]);
  return (
    <Table label="Issues">
      <thead><tr><Th width="34px" /><Th width="26px" /><Th>Issue</Th><Th>Linear</Th><Th>Kor run</Th><Th>Model</Th><Th align="right">Cost</Th><Th>Action</Th></tr></thead>
      <tbody>
        {rows.map(({ issue, run }) => {
          const sel = selected.includes(issue.id);
          const readiness = run ? latestDecision(decisions, run.executionId, 'readiness') : undefined;
          return (
            <Tr key={issue.id}>
              <Td first selected={sel || run?.status === 'waiting'} tall><Checkbox checked={sel} onChange={() => toggle(issue.id)} label={`Select ${issueKey(issue)}`} /></Td>
              <Td selected={sel || run?.status === 'waiting'} tall><Priority value={issue.priority} /></Td>
              <Td selected={sel || run?.status === 'waiting'} tall>
                <span {...stylex.props(layout.row, styles.title)}>
                  <a href={run ? href('linear', run.executionId) : issue.url} {...stylex.props(text.key)}>{issueKey(issue)}</a>
                  <span {...stylex.props(text.ellipsis)} title={issue.title}>{issue.title}</span>
                  {issue.labels.includes(intake) && <Pill tone="violet" small>{intake}</Pill>}
                </span>
              </Td>
              <Td selected={sel || run?.status === 'waiting'} tall><span {...stylex.props(layout.row)}><LinearState kind={linearStateKind(issue.stateType, issue.stateName)} />{issue.stateName ?? issue.stateType}</span></Td>
              <Td selected={sel || run?.status === 'waiting'} tall>
                {run ? (
                  <div {...stylex.props(styles.korCell)}>
                    <StatusPill status={run.status} detail={run.status === 'running' || run.status === 'waiting' ? run.stage : run.status === 'failed' ? `attempt ${run.attempts}` : run.status === 'complete' && run.pullRequestUrl ? 'merged' : undefined} small />
                    {isActive(run) || run.status === 'waiting' ? <StageTrack stage={run.stage} status={run.status} /> : null}
                    {readiness && !isActive(run) && run.status === 'queued' && <span {...stylex.props(text.mono, text.micro, text.muted)}>Jev {prob(readiness.confidence)}</span>}
                  </div>
                ) : issue.acceptanceCriteria.length === 0 && isOpen(issue) ? <Pill tone="amber" small dot>no criteria</Pill> : issue.labels.includes(intake) || !isOpen(issue) ? <span {...stylex.props(text.mono, text.xs, text.muted)}>{isOpen(issue) ? 'ready for Kor' : '—'}</span> : <span {...stylex.props(text.mono, text.xs, text.faint)}>not labelled {intake}</span>}
              </Td>
              <Td selected={sel || run?.status === 'waiting'} tall>{run?.route ? <div {...stylex.props(styles.mdl)}><div>{shortModel(run.route.model)}</div><div {...stylex.props(styles.mdlSub)}>{run.accountSlot.value ?? run.routeSource ?? ''}</div></div> : <span {...stylex.props(text.faint)}>—</span>}</Td>
              <Td selected={sel || run?.status === 'waiting'} tall align="right"><span {...stylex.props(text.mono)}>{usd(run?.costUsd)}</span></Td>
              <Td selected={sel || run?.status === 'waiting'} tall><IssueAction issue={issue} run={run} intake={intake} selected={sel} /></Td>
            </Tr>
          );
        })}
        {rows.length === 0 && <tr><Td colSpan={8}><span {...stylex.props(text.muted)}>No issues match this filter.</span></Td></tr>}
      </tbody>
    </Table>
  );
}

function RepositorySettings({ project }: { project: Project }) {
  const save = useSaveProject();
  const config = useConfig();
  const repository = config.data?.config.repos[project.id] ?? project.repository;
  const [draft, setDraft] = useState<KorConfig['repos'][string]>(repository);
  const [checks, setChecks] = useState(repository.checks.join('\n'));
  const [tools, setTools] = useState(repository.toolAllowlist.join('\n'));
  const [always, setAlways] = useState(repository.skills?.always.join('\n') ?? '');
  const [pins, setPins] = useState(repository.skills?.pins.join('\n') ?? '');
  const [never, setNever] = useState(repository.skills?.never.join('\n') ?? '');
  const [budget, setBudget] = useState(String(repository.skills?.budget ?? DEFAULT_SKILL_BUDGET));
  const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
  const submit = () => save.mutate({ project: project.id, repository: { ...draft, checks: lines(checks), toolAllowlist: lines(tools),
    skills: { always: lines(always), pins: lines(pins), never: lines(never), budget: Number(budget) } } });
  const set = (key: keyof KorConfig['repos'][string]) => (value: string) => setDraft(current => ({ ...current, [key]: value || undefined } as KorConfig['repos'][string]));
  return (
    <div {...stylex.props(styles.form)}>
      <FieldLabel>Checkout path</FieldLabel><TextInput label="Checkout path" value={draft.path} onChange={set('path')} mono />
      <FieldLabel>Remote</FieldLabel><TextInput label="Remote" value={draft.remote ?? ''} onChange={set('remote')} mono placeholder="origin URL (optional)" />
      <FieldLabel>Default branch</FieldLabel><TextInput label="Default branch" value={draft.defaultBranch} onChange={set('defaultBranch')} mono />
      <FieldLabel>Linear team</FieldLabel><TextInput label="Linear team" value={draft.linearTeam ?? ''} onChange={set('linearTeam')} mono placeholder="e.g. MAT" />
      <FieldLabel>Linear project</FieldLabel><TextInput label="Linear project" value={draft.linearProject ?? ''} onChange={set('linearProject')} mono placeholder="project ID (optional)" />
      <FieldLabel>Shipping<br /><span {...stylex.props(text.faint, text.xs)}>approve: verified runs wait for your go-ahead</span></FieldLabel>
      <Segmented label="Shipping" value={draft.ship} onChange={value => setDraft(current => ({ ...current, ship: value }))} options={[{ value: 'approve', label: 'Wait for my approval' }, { value: 'auto', label: 'Ship automatically' }]} />
      <FieldLabel>Repository checks<br /><span {...stylex.props(text.faint, text.xs)}>one command per line; every run must pass them</span></FieldLabel><TextArea label="Repository checks" value={checks} onChange={setChecks} mono rows={4} />
      <FieldLabel>Tool allowlist<br /><span {...stylex.props(text.faint, text.xs)}>the only tools a session may use</span></FieldLabel><TextArea label="Tool allowlist" value={tools} onChange={setTools} mono rows={5} />
      <FieldLabel>Always load skills<br /><span {...stylex.props(text.faint, text.xs)}>one name per line; loaded even when Jev is unavailable</span></FieldLabel><TextArea label="Always load skills" value={always} onChange={setAlways} mono rows={2} />
      <FieldLabel>Pinned skills<br /><span {...stylex.props(text.faint, text.xs)}>pinned whenever Jev plans a session</span></FieldLabel><TextArea label="Pinned skills" value={pins} onChange={setPins} mono rows={2} />
      <FieldLabel>Never load skills<br /><span {...stylex.props(text.faint, text.xs)}>wins over Jev, pins and overrides</span></FieldLabel><TextArea label="Never load skills" value={never} onChange={setNever} mono rows={2} />
      <FieldLabel>Skill budget<br /><span {...stylex.props(text.faint, text.xs)}>guidance tokens per turn</span></FieldLabel><TextInput label="Skill budget" type="number" value={budget} onChange={setBudget} mono />
      <span />
      <div {...stylex.props(layout.stackTight)}>
        {save.error && <Notice title={save.error.message} hint={save.error instanceof ApiFailure ? save.error.hint : undefined} />}
        {save.isSuccess && <Notice tone={save.data.restartRequired ? 'warn' : 'ok'} title={save.data.restartRequired ? 'Saved. Restart the daemon to apply it.' : 'Saved to ~/.config/kor/config.yaml.'} />}
        <div {...stylex.props(layout.row)}><Button variant="primary" icon={Check} busy={save.isPending} onClick={submit}>Save repository settings</Button><span {...stylex.props(text.muted, text.sm)}>Validated by the daemon and written atomically to config.yaml.</span></div>
      </div>
    </div>
  );
}

export function ProjectWorkspace({ projectId, tab: tabParam }: { projectId?: string; tab?: string }) {
  const now = useNow();
  const projects = useProjects();
  const config = useConfig();
  const { runs } = useMissionRuns();
  const overrides = useOverrides();
  const list = projects.data?.projects ?? [];
  const project = list.find(one => one.id === projectId) ?? list[0];
  const index = project ? list.indexOf(project) : 0;
  const [issuesEntry] = useAllIssues(project ? [project] : []);
  const pulls = usePulls(project?.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const queue = useQueue();
  const tab = (['overview', 'issues', 'runs', 'pulls', 'documents', 'settings'].includes(tabParam ?? '') ? tabParam : 'overview') as Tab;
  const setTab = (next: Tab) => project && navigate('projects', project.id, next);
  if (!project) {
    return (
      <AppFrame active="projects" crumbs={['Projects']}>
        <div {...stylex.props(page.page)}>
          {projects.error ? <QueryError error={projects.error} what="Projects" /> : <Card pad>{projects.isPending ? <Empty title="Reading the configured projects…" /> : <Empty slot="empty-no-issues" title="No projects configured.">Add a repository in <a href={href('settings')} {...stylex.props(text.link)}>Settings</a>.</Empty>}</Card>}
        </div>
      </AppFrame>
    );
  }
  const intake = config.data?.config.intakeLabel ?? 'kor';
  const issues = issuesEntry?.issues ?? [];
  const projectRuns = runs.filter(run => project.runs.some(one => one.executionId === run.executionId));
  const needle = search.trim().toLowerCase();
  const visible = issues.filter(issue => !needle || `${issueKey(issue)} ${issue.title}`.toLowerCase().includes(needle));
  const done = issues.filter(issue => issue.stateType === 'completed').length;
  const inProgress = issues.filter(issue => issue.stateType === 'started').length;
  const todo = issues.filter(issue => issue.stateType === 'unstarted' || issue.stateType === 'backlog' || issue.stateType === 'triage').length;
  const pct = issues.length ? (done / issues.length) * 100 : 0;
  const completedSeries = (() => {
    const times = issues.filter(issue => issue.stateType === 'completed').map(issue => Date.parse(issue.updatedAt)).sort((a, b) => a - b);
    return times.length >= 2 ? times.map((_, i) => i + 1) : null;
  })();
  const withCriteria = issues.filter(issue => issue.acceptanceCriteria.length > 0).length;
  const failedRuns = projectRuns.filter(run => run.status === 'failed');
  const failed7 = failedRuns.filter(run => run.completedAt !== null && now - Date.parse(run.completedAt) < 7 * 86_400_000).length;
  const failedUndated = failedRuns.filter(run => run.completedAt === null).length;
  const checkRuns = projectRuns.flatMap(run => run.verification?.attempts ?? []).flatMap(attempt => attempt.checks);
  const checkPass = checkRuns.length ? checkRuns.filter(check => check.status === 'pass').length / checkRuns.length : null;
  const verifiedRuns = projectRuns.filter(run => run.verification?.passed && run.costUsd !== undefined);
  const costPerVerified = verifiedRuns.length ? verifiedRuns.reduce((sum, run) => sum + (run.costUsd ?? 0), 0) / verifiedRuns.length : null;
  const scores = [checkPass, issues.length ? withCriteria / issues.length : null, projectRuns.length ? 1 - failed7 / projectRuns.length : null].filter((value): value is number => value !== null);
  const healthScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const grade = healthScore === null ? '—' : healthScore >= 0.9 ? 'A' : healthScore >= 0.8 ? 'B' : healthScore >= 0.65 ? 'C' : 'D';
  const readyIds = issues.filter(issue => isOpen(issue) && !projectRuns.some(run => run.issueId === issue.id && !FINISHED.has(run.status)) && issue.labels.includes(intake) && issue.acceptanceCriteria.length > 0).map(issue => issue.id);
  const selectedReady = selected.filter(id => readyIds.includes(id));
  const queueCount = selectedReady.length || readyIds.length;
  const queueSelected = (ids: readonly string[]) => { const [first, ...rest] = ids; if (first) queue.mutate({ issueIds: [first, ...rest] }, { onSuccess: () => setSelected([]) }); };
  const openPulls = pulls.data?.pulls.value.filter(pull => pull.state === 'open') ?? [];
  const activity = buildActivity(projectRuns, overrides.filter(record => projectRuns.some(run => run.executionId === record.executionId))).slice(0, 5);
  const teamUrl = issues.find(issue => issue.url)?.url?.replace(/\/issue\/.*$/, `/team/${project.repository.linearTeam ?? ''}`);
  const filters: { value: Filter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: issues.length },
    { value: 'kor', label: `Labelled ${intake}`, count: issues.filter(issue => issue.labels.includes(intake)).length },
    { value: 'running', label: 'Running', count: projectRuns.filter(isActive).length },
    { value: 'needs', label: 'Needs you', count: projectRuns.filter(run => needsYou(run) || run.status === 'waiting').length },
    { value: 'ready', label: 'Ready', count: readyIds.length },
  ];
  const tabs = [
    { value: 'overview' as const, label: 'Overview', icon: Layers },
    { value: 'issues' as const, label: 'Issues', icon: ListChecks, count: issues.length },
    { value: 'runs' as const, label: 'Runs', icon: Users, count: projectRuns.length },
    { value: 'pulls' as const, label: 'Pull requests', icon: GitPullRequest, count: pulls.data && pulls.data.pulls.provenance !== 'unavailable' ? openPulls.length : undefined },
    { value: 'documents' as const, label: 'Documents', icon: FileText, count: issues.reduce((sum, issue) => sum + issue.documents.length, 0) },
    { value: 'settings' as const, label: 'Repository settings', icon: SettingsIcon },
  ];
  const issuesCard = (
    <Card index={1} clip label="Issues">
      <div {...stylex.props(styles.toolbar)}>
        <PillTabs value={filter} onChange={setFilter} label="Issue filter" items={filters.map(item => ({ value: item.value, label: item.label, count: item.count }))} />
        <span {...stylex.props(layout.grow)} />
        <TextInput label="Filter issues" icon={Search} value={search} onChange={setSearch} placeholder="Filter issues…" />
        <Button icon={Funnel} onClick={() => openAsk({ prompt: `Which ${project.name} issues should Kor take next, by priority?` })}>Priority</Button>
      </div>
      {issuesEntry?.provenance === 'unavailable' && <div {...stylex.props(styles.toolbar)}><Notice title={`Linear unavailable: ${issuesEntry.reason ?? 'no reason given'}`} /></div>}
      <div {...stylex.props(styles.tableWrap)}>
        {issuesEntry?.provenance === 'loading' ? <Empty title="Reading Linear…" /> : <IssuesTable issues={visible} runs={projectRuns} intake={intake} selected={selected} setSelected={setSelected} filter={filter} />}
      </div>
      {selected.length > 0 && (
        <div {...stylex.props(styles.selbar)}>
          <Checkbox checked onChange={() => setSelected([])} label="Clear selection" />
          <b>{selected.length} selected</b>
          <span {...stylex.props(text.mono, text.xs, text.muted, text.ellipsis)}>{selected.map(id => issueKey(issues.find(issue => issue.id === id)!)).join(' · ')} · {selectedReady.length} ready</span>
          <span {...stylex.props(layout.grow)} />
          <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => openAsk({ prompt: `Check these ${project.name} issues before I queue them: ${selected.map(id => issueKey(issues.find(issue => issue.id === id)!)).join(', ')}` })}>Ask Jev to check</Button>
          <Button size="sm" icon={RouteIcon} onClick={() => navigate('models')}>Route…</Button>
          <Button size="sm" variant="primary" icon={Play} busy={queue.isPending} disabled={selectedReady.length === 0} onClick={() => queueSelected(selectedReady)}>Queue for Kor</Button>
        </div>
      )}
      {queue.error && <div {...stylex.props(styles.toolbar)}><Notice title={queue.error.message} hint={queue.error instanceof ApiFailure ? queue.error.hint : undefined} /></div>}
      <div {...stylex.props(styles.foot)}>{visible.length} of {issues.length} issues · sorted by Kor status<span {...stylex.props(layout.grow)} />{issuesEntry?.observedAt && <ProvenanceChip provenance={issuesEntry.provenance === 'loading' ? 'unavailable' : issuesEntry.provenance}>linear {ago(issuesEntry.observedAt, now)}</ProvenanceChip>}</div>
    </Card>
  );
  return (
    <AppFrame active="projects" project={project.id} crumbs={['Projects', project.name]} askHint={`Ask Jev about ${project.name} — "queue every ready issue", "why is an issue not ready?"`}>
      <div {...stylex.props(page.page)}>
        <Card index={0} style={styles.head} label={project.name}>
          <span {...stylex.props(styles.halo)} />
          <span {...stylex.props(styles.logo)}>{initials(project.name)}</span>
          <div>
            <h1 {...stylex.props(styles.h1)}>{project.name}<Pill tone={projectRuns.some(needsYou) ? 'amber' : 'green'} dot>{projectRuns.some(needsYou) ? 'needs you' : 'on track'}</Pill></h1>
            <div {...stylex.props(styles.meta)}>
              {project.repository.remote && <span {...stylex.props(styles.metaItem)}><BrandMark brand="github" size={13} />{project.repository.remote.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')}</span>}
              <span {...stylex.props(styles.metaItem)}><Icon icon={GitBranch} size={13} />{project.repository.defaultBranch}</span>
              {project.repository.linearTeam && <span {...stylex.props(styles.metaItem)}><BrandMark brand="linear" size={13} />team {project.repository.linearTeam}</span>}
              <span {...stylex.props(styles.metaItem)}><Icon icon={ShieldCheck} size={13} />{project.repository.checks.length} checks</span>
              {issuesEntry && issuesEntry.provenance !== 'loading' && <ProvenanceChip provenance={issuesEntry.provenance} reason={issuesEntry.reason}>{issuesEntry.provenance} · linear {issuesEntry.observedAt ? ago(issuesEntry.observedAt, now) : ''}</ProvenanceChip>}
            </div>
          </div>
          <span {...stylex.props(layout.grow)} />
          {teamUrl && <Button brand="linear" href={teamUrl} external>Open in Linear</Button>}
          <Button icon={SettingsIcon} onClick={() => setTab('settings')}>Settings</Button>
          <Button variant="primary" icon={Play} busy={queue.isPending} disabled={readyIds.length === 0} onClick={() => queueSelected(selectedReady.length ? selectedReady : readyIds)}>Queue {queueCount} {queueCount === 1 ? 'issue' : 'issues'} for Kor</Button>
        </Card>
        <Tabs value={tab} onChange={setTab} items={tabs} label="Project views" />
        {tab === 'overview' && (
          <div {...stylex.props(styles.body)}>
            {issuesCard}
            <div {...stylex.props(styles.side)}>
              <Card index={2}>
                <CardHeader icon={FolderKanban} title="Progress" aside={<span {...stylex.props(text.mono, text.xs, text.muted)}>Linear issues</span>} />
                <CardBody>
                  <div {...stylex.props(layout.row, layout.gap4)}><span {...stylex.props(styles.bigPct, text.grad)}>{issues.length ? `${Math.round(pct)}%` : '—'}</span><div {...stylex.props(layout.grow)}><div {...stylex.props(text.mono, text.xs, text.muted)}>{done} of {issues.length} done</div></div></div>
                  <div {...stylex.props(styles.stats4)}>
                    <div {...stylex.props(styles.stat, styles.edgeViolet)}><b {...stylex.props(styles.statValue)}>{issues.length}</b><span {...stylex.props(styles.statLabel)}>total</span></div>
                    <div {...stylex.props(styles.stat, styles.edgeGreen)}><b {...stylex.props(styles.statValue)}>{done}</b><span {...stylex.props(styles.statLabel)}>done</span></div>
                    <div {...stylex.props(styles.stat, styles.edgeAmber)}><b {...stylex.props(styles.statValue)}>{inProgress}</b><span {...stylex.props(styles.statLabel)}>in progress</span></div>
                    <div {...stylex.props(styles.stat, styles.edgeSlate)}><b {...stylex.props(styles.statValue)}>{todo}</b><span {...stylex.props(styles.statLabel)}>todo</span></div>
                  </div>
                  {completedSeries && <div {...stylex.props(layout.mt3)}><Spark values={completedSeries} tone="cyan" width={340} height={46} label="issues done over time, by last update" /></div>}
                </CardBody>
              </Card>
              <Card index={3}>
                <CardHeader icon={ShieldCheck} title="Health" aside={healthScore !== null ? <Pill tone={grade === 'A' || grade === 'B' ? 'green' : 'amber'} small>{grade === 'A' || grade === 'B' ? 'healthy' : 'watch'}</Pill> : undefined} />
                <CardBody>
                  <div {...stylex.props(styles.health)}>
                    <Ring pct={(healthScore ?? 0) * 100} size={78} stroke={7} from="cyan" to="green" label={`Health grade ${grade}`}><span {...stylex.props(styles.grade, text.grad)}>{grade}</span></Ring>
                    <div {...stylex.props(styles.hl)}>
                      <div {...stylex.props(styles.hlRow)}><Icon icon={CircleCheck} size={14} style={text.green} />Repository checks<b {...stylex.props(styles.hlVal)}>{checkPass === null ? '—' : `${Math.round(checkPass * 100)}% pass`}</b></div>
                      <div {...stylex.props(styles.hlRow)}><Icon icon={ListChecks} size={14} style={text.cyan} />Issues with criteria<b {...stylex.props(styles.hlVal)}>{withCriteria} / {issues.length}</b></div>
                      <div {...stylex.props(styles.hlRow)}><Icon icon={CircleAlert} size={14} style={text.amber} />Failed runs (7 days)<b {...stylex.props(styles.hlVal)} title={failedUndated ? `${failedUndated} failed runs have no recorded completion time and are not counted` : undefined}>{failed7}{failedUndated ? ` · ${failedUndated} undated` : ''}</b></div>
                      <div {...stylex.props(styles.hlRow)}><Icon icon={Timer} size={14} style={text.violet} />Runs with a PR<b {...stylex.props(styles.hlVal)}>{projectRuns.filter(run => run.pullRequestUrl).length}</b></div>
                      <div {...stylex.props(styles.hlRow)}><Icon icon={Coins} size={14} style={text.violet} />Cost per verified run<b {...stylex.props(styles.hlVal)}>{usd(costPerVerified)}</b></div>
                    </div>
                  </div>
                </CardBody>
              </Card>
              <Card index={4}>
                <CardHeader icon={GitPullRequest} title="Pull requests" aside={pulls.data && <ProvenanceChip provenance={pulls.data.pulls.provenance} reason={pulls.data.pulls.reason}>GitHub</ProvenanceChip>} />
                <CardBody>
                  {pulls.error && <QueryError error={pulls.error} what="Pull requests" />}
                  {pulls.data?.pulls.provenance === 'unavailable' && <Notice tone="warn" title={`Pull requests unavailable: ${pulls.data.pulls.reason ?? 'GitHub did not answer'}`} hint="Connect GitHub in Settings; this is not evidence that nothing awaits review." />}
                  {openPulls.slice(0, 4).map(pull => {
                    const run = projectRuns.find(one => one.pullRequestUrl === pull.url);
                    return (
                      <div key={pull.number} {...stylex.props(styles.pr)}>
                        <Icon icon={GitPullRequest} size={16} style={text.violet} />
                        <div><div {...stylex.props(styles.prTitle, text.ellipsis)}>#{pull.number} {pull.title}</div><div {...stylex.props(styles.prSub)}>{run ? keyOf(run) : pull.head}{pull.draft ? ' · draft' : ''}</div></div>
                        <Button size="sm" href={pull.url} external>Open</Button>
                      </div>
                    );
                  })}
                  {pulls.data && pulls.data.pulls.provenance !== 'unavailable' && openPulls.length === 0 && <span {...stylex.props(text.muted)}>No open pull requests.</span>}
                </CardBody>
              </Card>
              <Card index={5}>
                <CardHeader icon={ActivityIcon} title="Activity" />
                <CardBody><Feed>{activity.map(item => <a key={item.id} href={href('agents', item.executionId)}><FeedItem tone={item.tone} icon={item.icon} when={ago(item.at, now)}><b {...stylex.props(text.strong)}>{item.key}</b> {item.text}</FeedItem></a>)}</Feed>{activity.length === 0 && <span {...stylex.props(text.muted)}>No Kor activity on this project yet.</span>}</CardBody>
              </Card>
            </div>
          </div>
        )}
        {tab === 'issues' && issuesCard}
        {tab === 'runs' && (
          <Card index={1} clip>
            <div {...stylex.props(styles.tableWrap)}>
              <Table label="Runs">
                <thead><tr><Th>Issue</Th><Th>Status</Th><Th>Stage</Th><Th>Model</Th><Th>Attempts</Th><Th align="right">Cost</Th><Th>PR</Th><Th>Updated</Th></tr></thead>
                <tbody>
                  {projectRuns.map(run => (
                    <Tr key={run.executionId} label={`Open ${keyOf(run)} in Agents`} onClick={() => navigate('agents', run.executionId)}>
                      <Td><span {...stylex.props(layout.row)}><a href={href('agents', run.executionId)} tabIndex={-1} {...stylex.props(text.key)}>{keyOf(run)}</a><span {...stylex.props(text.ellipsis)}>{run.issueTitle}</span></span></Td>
                      <Td><StatusPill status={run.status} small /></Td>
                      <Td><StageTrack stage={run.stage} status={run.status} /></Td>
                      <Td><span {...stylex.props(text.mono, text.sm)}>{shortModel(run.route?.model)}</span></Td>
                      <Td><span {...stylex.props(text.mono)}>{run.attempts}</span></Td>
                      <Td align="right"><span {...stylex.props(text.mono)}>{usd(run.costUsd)}</span></Td>
                      <Td>{run.pullRequestUrl ? <a href={run.pullRequestUrl} target="_blank" rel="noopener noreferrer" {...stylex.props(text.cyan, text.mono)}>{prNumber(run.pullRequestUrl)}</a> : '—'}</Td>
                      <Td><span {...stylex.props(text.mono, text.muted, text.xs)}>{runUpdatedAt(run) ? shortDate(runUpdatedAt(run)!) : 'undated'}</span></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {projectRuns.length === 0 && <Empty slot="empty-no-runs" title="Kor has not run anything on this project yet." />}
            </div>
          </Card>
        )}
        {tab === 'pulls' && (
          <Card index={1} pad>
            {pulls.error && <QueryError error={pulls.error} what="Pull requests" />}
            {(pulls.data?.pulls.value ?? []).map(pull => (
              <div key={pull.number} {...stylex.props(styles.pr)}>
                <Icon icon={GitPullRequest} size={16} style={pull.merged ? text.violet : pull.state === 'open' ? text.green : text.muted} />
                <div><div {...stylex.props(styles.prTitle)}>#{pull.number} {pull.title}</div><div {...stylex.props(styles.prSub)}>{pull.head} · {pull.merged ? 'merged' : pull.state}{pull.draft ? ' · draft' : ''}</div></div>
                <Button size="sm" href={pull.url} external>Open</Button>
              </div>
            ))}
            {pulls.data?.pulls.provenance === 'unavailable' ? <Empty slot="empty-pool-unavailable" title="Pull requests unavailable.">{pulls.data.pulls.reason ?? 'GitHub did not answer.'} Connect GitHub in Settings.</Empty> : pulls.data && pulls.data.pulls.value.length === 0 && <Empty title="No pull requests." />}
          </Card>
        )}
        {tab === 'documents' && (
          <Card index={1} pad>
            {issues.flatMap(issue => issue.documents.map(doc => ({ doc, issue }))).map(({ doc, issue }) => (
              <div key={doc.id} {...stylex.props(styles.doc)}>
                <Icon icon={BookOpen} size={16} style={text.violet} />
                <div><b {...stylex.props(text.strong)}>{doc.title}</b><div {...stylex.props(styles.docBody)}>{doc.content}</div></div>
                <a href={issue.url} target="_blank" rel="noopener noreferrer" {...stylex.props(text.key)}>{issueKey(issue)}</a>
              </div>
            ))}
            {issues.every(issue => issue.documents.length === 0) && <Empty title="No documents attached to this project's issues." />}
          </Card>
        )}
        {tab === 'settings' && <Card index={1}><RepositorySettings key={project.id} project={project} /></Card>}
      </div>
    </AppFrame>
  );
}

