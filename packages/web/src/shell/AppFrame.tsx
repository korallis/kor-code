// The shell every screen shares: top bar (Kor Code mark, breadcrumb, Ask Jev,
// live status, clock), sidebar (navigation, projects, connections, Jev) and the
// status bar (pool, windows, slots, spend, daemon).
import * as stylex from '@stylexjs/stylex';
import { Bell, Bot, BrainCircuit, Cpu, FolderKanban, House, Network, Settings, Sparkles, SquareTerminal, Aperture, CircleSlash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useConfig, useConnections, useModels, useProjects } from '../api/queries';
import { useDecisions, useMissionRuns, usePoolLive, useStatusResponse } from '../api/data';
import { useLive, reconnect } from '../api/live';
import { isOpen, useAllIssues } from '../api/issues';
import { href, type Screen } from '../router';
import { color, font, glow, gradient, layout as dims, space, tint, tracking } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';
import { BrandMark, Icon } from '../ui/icon';
import type { Brand } from '../ui/brands';
import { Kbd } from '../ui/button';
import { JevOrb } from '../ui/orb';
import { ProvenanceChip } from '../ui/pill';
import { Swatch } from '../ui/glyphs';
import { text } from '../ui/text';
import { ago, clock, day, isToday, useNow } from '../lib/time';
import { usd } from '../lib/format';
import { isActive, needsYou, runUpdatedAt } from '../lib/runs';
import { parseQuota, providerTitle, sessionWindow, weeklyWindow } from '../lib/quota';
import { KorMark } from './Mark';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { MotionMedia } from '../motion/MotionMedia';
import { openAsk } from './askStore';
import { projectTone } from './projectTone';

const NARROW = '@media (max-width: 1499px)';

const styles = stylex.create({
  app: {
    position: 'relative', height: '100vh', minWidth: '1180px', overflow: 'hidden', display: 'grid', isolation: 'isolate',
    gridTemplateColumns: `${dims.sidebarWidth} minmax(0, 1fr)`, gridTemplateRows: `${dims.topBarHeight} minmax(0, 1fr) ${dims.statusBarHeight}`,
    gridTemplateAreas: '"top top" "side main" "status status"',
    backgroundImage: gradient.canvas, backgroundColor: color.canvas,
    fontFamily: font.sans, fontSize: '13px', lineHeight: 1.5, color: color.text,
  },
  stars: { position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none', backgroundImage: tint.starField, backgroundSize: '380px 220px', opacity: 0.55 },
  grid: { position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none', backgroundImage: tint.dotGrid, backgroundSize: '24px 24px', maskImage: tint.dotGridMask },
  top: { gridArea: 'top', display: 'grid', gridTemplateColumns: `${dims.sidebarWidth} minmax(0, 1fr) auto`, alignItems: 'center', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline, backgroundImage: tint.topBar, backdropFilter: `blur(${dims.glassBlur})`, position: 'relative', zIndex: 2 },
  topLine: { position: 'absolute', left: 0, right: 0, bottom: '-1px', height: '1px', backgroundImage: gradient.brand, opacity: 0.35 },
  brand: { display: 'flex', alignItems: 'center', gap: '11px', paddingInline: space.s5, height: '100%', borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: color.hairline },
  word: { display: 'flex', flexDirection: 'column', lineHeight: 1 },
  name: { fontFamily: font.display, fontWeight: 700, fontSize: '19px', letterSpacing: '.04em', display: 'flex', gap: '6px', alignItems: 'baseline' },
  code: { fontWeight: 500, color: color.text, letterSpacing: '.14em', fontSize: '15px' },
  sub: { fontFamily: font.mono, fontSize: '9.5px', letterSpacing: tracking.wide, color: color.textMuted, textTransform: 'uppercase', marginTop: '6px' },
  mid: { display: 'flex', alignItems: 'center', gap: space.s5, paddingInline: space.s6, minWidth: 0 },
  crumb: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: color.textMuted, whiteSpace: 'nowrap', minWidth: 0 },
  crumbLast: { color: color.text, fontWeight: 600 },
  sep: { color: color.textFaint },
  askbar: {
    flex: '1', maxWidth: '620px', marginLeft: 'auto', height: '40px', display: 'flex', alignItems: 'center', gap: '10px', paddingInline: '12px 8px', borderRadius: '12px',
    backgroundColor: color.surfaceSunken, borderWidth: '1px', borderStyle: 'solid', borderColor: { default: color.hairlineStrong, ':hover': tint.violetEdgeStrong }, color: color.textMuted, fontSize: '14px', cursor: 'text', minWidth: 0, textAlign: 'left',
  },
  askIcon: { color: color.violetBright },
  askText: { flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  right: { display: 'flex', alignItems: 'center', gap: space.s4, paddingRight: space.s6, whiteSpace: 'nowrap' },
  live: { display: 'inline-flex', alignItems: 'center', gap: '8px', height: '30px', paddingInline: '12px', borderRadius: '999px', borderWidth: '1px', borderStyle: 'solid', fontFamily: font.mono, fontSize: '11px', letterSpacing: '.06em', cursor: 'default' },
  liveOk: { backgroundColor: color.greenDim, borderColor: tint.livePillEdge, color: color.green },
  liveWarn: { backgroundColor: color.amberDim, borderColor: tint.amberEdge, color: color.amber, cursor: 'pointer' },
  liveDot: { width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'currentColor', boxShadow: '0 0 8px currentColor' },
  liveSub: { color: color.textSecondary, letterSpacing: 0, display: { default: 'inline', [NARROW]: 'none' } },
  iconBtn: { position: 'relative', width: '34px', height: '34px', borderRadius: '10px', display: 'grid', placeItems: 'center', color: color.textSecondary, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, backgroundColor: { default: tint.ghost, ':hover': tint.ghostStrong } },
  badge: { position: 'absolute', top: '6px', right: '7px', width: '7px', height: '7px', borderRadius: '50%', backgroundColor: color.amber, boxShadow: glow.amber },
  clock: { textAlign: 'right', lineHeight: 1.2 },
  time: { fontFamily: font.display, fontSize: '17px', fontWeight: 600, letterSpacing: '.02em' },
  date: { fontFamily: font.mono, fontSize: '10px', color: color.textMuted, letterSpacing: '.08em', textTransform: 'uppercase' },
  side: { gridArea: 'side', display: 'flex', flexDirection: 'column', gap: space.s1, paddingBlock: space.s5, paddingInline: space.s3, borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: color.hairline, backgroundImage: tint.sideBar, backdropFilter: `blur(${dims.glassBlur})`, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none' },
  navLabel: { fontFamily: font.mono, fontSize: '10px', letterSpacing: tracking.label, color: color.textFaint, textTransform: 'uppercase', paddingBlock: `${space.s3} ${space.s2}`, paddingInline: space.s3, marginTop: space.s2 },
  nav: { position: 'relative', display: 'flex', alignItems: 'center', gap: '12px', height: '40px', flex: 'none', paddingInline: '12px', borderRadius: '10px', color: { default: color.textSecondary, ':hover': color.text }, fontSize: '14px', fontWeight: 500, backgroundColor: { default: 'transparent', ':hover': tint.ghost }, transitionProperty: 'background-color, color', transitionDuration: '120ms' },
  navIcon: { color: color.textMuted },
  navActive: { color: color.text, backgroundImage: tint.navActive, boxShadow: tint.navActiveShadow },
  navActiveIcon: { color: color.violetNeon, filter: tint.iconGlow },
  navEdge: { position: 'absolute', left: '-12px', top: '9px', bottom: '9px', width: '3px', borderRadius: '0 3px 3px 0', backgroundImage: gradient.brand, boxShadow: glow.violet },
  count: { marginLeft: 'auto', fontFamily: font.mono, fontSize: '11px', color: color.textMuted },
  hot: { color: color.cyan },
  warn: { color: color.amber },
  pushRight: { marginLeft: 'auto' },
  project: { height: '32px', fontSize: '13px' },
  swatch: { marginInline: '5px' },
  spacer: { flex: '1', minHeight: space.s4 },
  conn: { display: 'grid', gap: '6px', padding: '12px', borderRadius: '12px', borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, backgroundColor: { default: tint.ghost, ':hover': tint.ghostStrong }, marginBottom: space.s2, flex: 'none' },
  connRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: color.textSecondary },
  connIcon: { color: color.textMuted },
  connOk: { marginLeft: 'auto', fontFamily: font.mono, fontSize: '10.5px', color: color.green },
  connBad: { color: color.amber },
  jev: { display: 'flex', gap: '12px', alignItems: 'center', padding: '12px', borderRadius: '14px', backgroundImage: tint.jevCard, borderWidth: '1px', borderStyle: 'solid', borderColor: tint.jevCardEdge, flex: 'none' },
  jevName: { fontFamily: font.display, fontWeight: 600, fontSize: '14px' },
  jevSub: { fontSize: '11px', color: color.textMuted },
  jevDot: { color: color.green },
  main: { gridArea: 'main', minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  status: { gridArea: 'status', display: 'flex', alignItems: 'stretch', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: color.hairline, backgroundColor: tint.statusBar, fontFamily: font.mono, fontSize: '11px', color: color.textMuted, overflow: 'hidden' },
  seg: { display: 'flex', alignItems: 'center', gap: '12px', paddingInline: '16px', borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: color.hairline, whiteSpace: 'nowrap' },
  segRight: { marginLeft: 'auto', borderRightWidth: 0, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: color.hairline },
  lbl: { fontSize: '9.5px', letterSpacing: tracking.label, color: color.textFaint, textTransform: 'uppercase' },
  b: { color: color.textSecondary, fontWeight: 500 },
  acct: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: color.textSecondary },
  claude: { color: tint.providerClaude },
  codex: { color: tint.providerCodex },
  copilot: { color: color.violetBright },
  offline: { paddingInline: space.s6, paddingTop: space.s6 },
  offlineRow: { display: 'flex', alignItems: 'center', gap: space.s5 },
  offlineArt: { width: '160px', height: '100px', flex: 'none' },
  offlineTitle: { fontFamily: font.display, fontSize: '17px', fontWeight: 600 },
  hideNarrow: { display: { default: 'flex', [NARROW]: 'none' } },
  hideNarrowInline: { display: { default: 'inline', [NARROW]: 'none' } },
});

interface NavItem { screen: Screen; label: string; icon?: LucideIcon; brand?: Brand; count?: ReactNode; tone?: 'hot' | 'warn'; kbd?: string }

function TopBar({ crumbs, askHint, showAsk }: { crumbs: readonly string[]; askHint?: string; showAsk: boolean }) {
  const now = useNow();
  const connection = useLive(live => live.connection);
  const reason = useLive(live => live.reason);
  const status = useStatusResponse();
  const { runs } = useMissionRuns();
  const attention = runs.filter(needsYou).length;
  const ok = connection === 'live' && status?.provenance === 'live';
  const label = connection === 'live' ? (status?.provenance === 'stale' ? 'STALE' : 'LIVE') : connection === 'unauthorized' ? 'SIGNED OUT' : connection === 'offline' ? 'OFFLINE' : 'CONNECTING';
  return (
    <header {...stylex.props(styles.top)}>
      <span {...stylex.props(styles.topLine)} />
      <a href={href('home')} {...stylex.props(styles.brand)}>
        <KorMark />
        <div {...stylex.props(styles.word)}>
          <div {...stylex.props(styles.name)}><span {...stylex.props(text.grad)}>KOR</span><span {...stylex.props(styles.code)}>CODE</span></div>
          <div {...stylex.props(styles.sub)}>Mission Control</div>
        </div>
      </a>
      <div {...stylex.props(styles.mid)}>
        <nav aria-label="Breadcrumb" {...stylex.props(styles.crumb)}>
          {crumbs.map((crumb, index) => index === crumbs.length - 1
            ? <b key={index} {...stylex.props(styles.crumbLast, text.ellipsis)}>{crumb}</b>
            : <span key={index} {...stylex.props(layout_row)}><span>{crumb}</span><span {...stylex.props(styles.sep)}>/</span></span>)}
        </nav>
        {showAsk && (
          <button type="button" onClick={() => openAsk()} {...stylex.props(styles.askbar)} aria-label="Ask Jev">
            <Icon icon={Sparkles} size={18} style={styles.askIcon} />
            <span {...stylex.props(styles.askText)}>{askHint ?? 'Ask Jev — queue an issue, explain a decision, change a route…'}</span>
            <Kbd>⌘K</Kbd>
          </button>
        )}
      </div>
      <div {...stylex.props(styles.right)}>
        <span role="status" title={reason ?? status?.reason ?? undefined} onClick={ok ? undefined : reconnect} {...stylex.props(styles.live, ok ? styles.liveOk : styles.liveWarn)}>
          <span {...stylex.props(styles.liveDot, ok && animate.dotPulse)} />{label}<span {...stylex.props(styles.liveSub)}>daemon · {window.location.host}</span>
        </span>
        <a href={href('home')} aria-label={`${attention} need you`} title={attention ? `${attention} need you` : 'Nothing needs you'} {...stylex.props(styles.iconBtn)}>
          <Icon icon={Bell} size={18} />
          {attention > 0 && <span {...stylex.props(styles.badge, animate.ripple)} />}
        </a>
        <div {...stylex.props(styles.clock)}>
          <div {...stylex.props(styles.time)}>{clock(now)}</div>
          <div {...stylex.props(styles.date)}>{day(now)}</div>
        </div>
      </div>
    </header>
  );
}
const layout_row = stylex.create({ r: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }).r;

function SideBar({ active, project }: { active: Screen; project?: string }) {
  const { runs } = useMissionRuns();
  const projects = useProjects();
  const models = useModels();
  const connections = useConnections();
  const decisions = useDecisions();
  const issues = useAllIssues(projects.data?.projects ?? []);
  const openIssues = issues.reduce((sum, entry) => sum + entry.issues.filter(isOpen).length, 0);
  const attention = runs.filter(needsYou).length;
  const activeRuns = runs.filter(isActive).length;
  const evaluating = runs.some(run => run.status === 'evaluating');
  const items: NavItem[] = [
    { screen: 'home', label: 'Home', icon: House, count: attention || undefined, tone: 'warn' },
    { screen: 'projects', label: 'Projects', icon: FolderKanban, count: projects.data?.projects.length },
    { screen: 'linear', label: 'Linear', brand: 'linear', count: openIssues || undefined },
    { screen: 'agents', label: 'Agents', icon: Bot, count: activeRuns || undefined, tone: 'hot' },
    { screen: 'models', label: 'Models', icon: Cpu, count: models.data?.models.value.length },
    { screen: 'brain', label: 'Jev Brain', icon: BrainCircuit },
    { screen: 'terminal', label: 'Terminal', icon: SquareTerminal, kbd: '⌃`' },
    { screen: 'settings', label: 'Settings', icon: Settings },
  ];
  const connection = (id: 'linear' | 'github' | 'gateway') => connections.data?.connections.find(one => one.id === id);
  const connRow = (id: 'linear' | 'github' | 'gateway', label: string, glyph: ReactNode, okText: string) => {
    const found = connection(id);
    const ok = found?.status === 'connected';
    return (
      <div {...stylex.props(styles.connRow)} title={found?.reason ?? undefined}>
        {glyph}{label}
        <span {...stylex.props(styles.connOk, !ok && styles.connBad)}>● {found ? (ok ? okText : 'connect') : '…'}</span>
      </div>
    );
  };
  return (
    <nav aria-label="Main" {...stylex.props(styles.side)}>
      {items.map(item => {
        const on = item.screen === active;
        return (
          <a key={item.screen} href={href(item.screen)} aria-current={on ? 'page' : undefined} {...stylex.props(styles.nav, on && styles.navActive)}>
            {on && <span {...stylex.props(styles.navEdge)} />}
            {item.icon ? <Icon icon={item.icon} size={18} style={on ? styles.navActiveIcon : styles.navIcon} /> : <BrandMark brand={item.brand!} size={18} style={on ? styles.navActiveIcon : styles.navIcon} />}
            <span>{item.label}</span>
            {item.kbd ? <span {...stylex.props(styles.pushRight)}><Kbd>{item.kbd}</Kbd></span> : item.count !== undefined && <span {...stylex.props(styles.count, item.tone === 'hot' && styles.hot, item.tone === 'warn' && styles.warn)}>{item.count}</span>}
          </a>
        );
      })}
      <div {...stylex.props(styles.navLabel)}>Projects</div>
      {(projects.data?.projects ?? []).map((one, index) => (
        <a key={one.id} href={href('projects', one.id)} aria-current={active === 'projects' && project === one.id ? 'page' : undefined} {...stylex.props(styles.nav, styles.project, active === 'projects' && project === one.id && styles.navActive)}>
          <span {...stylex.props(styles.swatch)}><Swatch tone={projectTone(index)} /></span>
          <span {...stylex.props(text.ellipsis)}>{one.name}</span>
          <span {...stylex.props(styles.count)}>{one.runs.length}</span>
        </a>
      ))}
      {projects.isError && <span {...stylex.props(styles.navLabel)}><ProvenanceChip provenance="unavailable" reason={projects.error.message}>projects unavailable</ProvenanceChip></span>}
      <div {...stylex.props(styles.spacer)} />
      <a href={href('settings')} {...stylex.props(styles.conn)} aria-label="Connections">
        {connRow('linear', 'Linear', <BrandMark brand="linear" size={14} style={styles.connIcon} />, 'connected')}
        {connRow('github', 'GitHub', <BrandMark brand="github" size={14} style={styles.connIcon} />, 'gh-axi')}
        {connRow('gateway', 'Gateway', <Icon icon={Network} size={14} style={styles.connIcon} />, 'CLIProxyAPI')}
      </a>
      <a href={href('brain')} {...stylex.props(styles.jev)}>
        <JevOrb size={36} state={evaluating ? 'thinking' : 'idle'} />
        <div>
          <div {...stylex.props(styles.jevName)}>Jev</div>
          <div {...stylex.props(styles.jevSub)}><b {...stylex.props(styles.jevDot)}>●</b> {evaluating ? 'deciding' : 'watching'} · {decisions.length.toLocaleString('en-GB')} decisions</div>
        </div>
      </a>
    </nav>
  );
}

function StatusBar() {
  const now = useNow();
  const decisions = useDecisions();
  const status = useStatusResponse();
  const { runs } = useMissionRuns();
  const pool = usePoolLive();
  const config = useConfig();
  const lastEventAt = useLive(live => live.lastEventAt);
  const quota = parseQuota(pool.quota?.value ?? null);
  const accounts = pool.accounts?.value ?? [];
  const byProvider = new Map<string, { total: number; ok: number }>();
  for (const account of accounts) {
    const key = (account.provider ?? 'other').toLowerCase().replace('anthropic', 'claude');
    const entry = byProvider.get(key) ?? { total: 0, ok: 0 };
    entry.total += 1; if (account.status === 'available') entry.ok += 1;
    byProvider.set(key, entry);
  }
  const claude = quota.find(provider => provider.provider === 'claude');
  const five = sessionWindow(claude), week = weeklyWindow(claude);
  const limits = config.data?.config.limits;
  const today = runs.filter(run => isToday(runUpdatedAt(run, decisions), now));
  const spend = today.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
  const verified = today.filter(run => run.verification?.passed).length;
  const prs = runs.filter(run => run.pullRequestUrl && run.status === 'review').length;
  const daemon = status?.snapshot?.daemon;
  const providerIcon = (key: string) => key === 'claude' ? <BrandMark brand="claude" size={13} /> : key === 'copilot' ? <BrandMark brand="githubcopilot" size={13} /> : key === 'grok' ? <Icon icon={CircleSlash2} size={13} /> : <Icon icon={Aperture} size={13} />;
  return (
    <footer {...stylex.props(styles.status)}>
      <div {...stylex.props(styles.seg)}>
        <span {...stylex.props(styles.lbl)}>Pool</span>
        {byProvider.size === 0 && <ProvenanceChip provenance={pool.accounts?.provenance ?? 'unavailable'} reason={pool.accounts?.reason}>{pool.accounts ? 'no accounts' : 'pool unavailable'}</ProvenanceChip>}
        {[...byProvider].map(([key, entry]) => (
          <span key={key} {...stylex.props(styles.acct, key === 'claude' && styles.claude, key === 'codex' && styles.codex, key === 'copilot' && styles.copilot)}>{providerIcon(key)}<b {...stylex.props(styles.b)}>{providerTitle(key)} {entry.ok}/{entry.total}</b></span>
        ))}
      </div>
      <div {...stylex.props(styles.seg, styles.hideNarrow)}>
        <span {...stylex.props(styles.lbl)}>5h</span><b {...stylex.props(styles.b)}>{five?.percentRemaining != null ? `${Math.round(five.percentRemaining)}%` : '—'}</b>
        {five?.resetsAt && <span>resets {clock(five.resetsAt)}</span>}
        <span {...stylex.props(styles.lbl)}>Week</span><b {...stylex.props(styles.b)}>{week?.percentRemaining != null ? `${Math.round(week.percentRemaining)}%` : '—'}</b>
      </div>
      <div {...stylex.props(styles.seg)}>
        <span {...stylex.props(styles.lbl)}>Slots</span><b {...stylex.props(styles.b)}>{runs.filter(isActive).length} / {limits?.total ?? '—'}</b><span>per repo {limits?.perRepository ?? '—'}</span>
      </div>
      <div {...stylex.props(styles.seg)}>
        <span {...stylex.props(styles.lbl)}>Today</span><b {...stylex.props(styles.b)}>{usd(spend)}</b><span>{verified} verified · {prs} PRs</span>
      </div>
      <div {...stylex.props(styles.seg, styles.segRight)}>
        {daemon && <span {...stylex.props(styles.hideNarrowInline)}>pid {daemon.pid} · poll {daemon.pollIntervalSeconds}s · last {ago(daemon.lastPollAt, now)} ago</span>}
        <ProvenanceChip provenance={status?.provenance ?? 'unavailable'} reason={status?.reason}>{status ? status.provenance : 'connecting'}{lastEventAt ? ` · ${ago(new Date(lastEventAt).toISOString(), now)}` : ''}</ProvenanceChip>
      </div>
    </footer>
  );
}

/** When the event stream has failed repeatedly, say so above every screen, with the daemon-offline art and a reconnect. */
function Offline() {
  const connection = useLive(live => live.connection);
  const reason = useLive(live => live.reason);
  if (connection !== 'offline') return null;
  return (
    <div {...stylex.props(styles.offline)}>
      <Card pad variant="attention">
        <div {...stylex.props(styles.offlineRow)}>
          <MotionMedia slot="empty-daemon-offline" contain fallback={null} style={styles.offlineArt} />
          <div>
            <div {...stylex.props(styles.offlineTitle)}>The Kor daemon is not answering.</div>
            <div {...stylex.props(text.muted)}>{reason ?? 'The live event stream closed.'} Every value below is the last one Kor reported. Start it with <span {...stylex.props(text.mono, text.cyan)}>kor serve</span>.</div>
          </div>
          <span {...stylex.props(styles.pushRight)}><Button variant="warn" onClick={reconnect}>Reconnect</Button></span>
        </div>
      </Card>
    </div>
  );
}

export function AppFrame({ active, crumbs, askHint, showAsk = true, project, children }: { active: Screen; crumbs: readonly string[]; askHint?: string; showAsk?: boolean; project?: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.app)}>
      <span {...stylex.props(styles.stars)} />
      <span {...stylex.props(styles.grid)} />
      <TopBar crumbs={crumbs} askHint={askHint} showAsk={showAsk} />
      <SideBar active={active} project={project} />
      <main {...stylex.props(styles.main)}><Offline />{children}</main>
      <StatusBar />
    </div>
  );
}

export const frameStyles = styles;
