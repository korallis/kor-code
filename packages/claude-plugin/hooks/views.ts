// Builds every cockpit view as plain rows, each carrying its provenance, so
// the pane and the text output draw the same values with the same labels.

import type { KorOverride, KorProvenance, KorView, KorViewId } from '../types'
import {
  ACCOUNTS,
  AGENTS,
  CONTEXT,
  CONTEXT_DROPPED,
  DECISIONS,
  EVENTS,
  EXECUTION,
  ISSUE,
  PROJECT,
  STAGES,
  type AcceptanceStatus,
  type Account,
  type AgentStatus,
  type Decision,
  type ExecutionEvent,
  type ExecutionStatus,
  type Stage,
} from './fixture'

export type Tone = 'ok' | 'warn' | 'bad' | 'dim' | 'accent'
export type Row = { cells: string[]; provenance: KorProvenance; tone?: Tone; open?: KorView }
export type Section = { title: string; rows: Row[] }
export type ViewModel = { title: string; sections: Section[] }

/** What the session itself reports; the only values the cockpit draws as live. */
export type LiveFacts = { claudeCode: string }

export const VIEWS: Array<{ id: KorViewId; label: string; hotkey: string }> = [
  { id: 'cockpit', label: 'Cockpit', hotkey: '1' },
  { id: 'issue', label: 'Issue', hotkey: '2' },
  { id: 'project', label: 'Project', hotkey: '3' },
  { id: 'decisions', label: 'Decisions', hotkey: '4' },
  { id: 'agents', label: 'Agents', hotkey: '5' },
  { id: 'accounts', label: 'Accounts', hotkey: '6' },
  { id: 'context', label: 'Context', hotkey: '7' },
  { id: 'linear', label: 'Linear', hotkey: '8' },
  { id: 'overrides', label: 'Overrides', hotkey: '9' },
]

export const LABEL: Record<KorProvenance, string> = { live: 'LIVE', stale: 'STALE', fixture: 'FIXTURE', unavailable: 'UNAVAILABLE' }

/** The execution as it stood after the first `cursor` events (all of them when null). */
export type Snapshot = {
  shown: ExecutionEvent[]
  stage: Stage
  status: ExecutionStatus
  agents: Array<{ id: string; role: string; status: AgentStatus }>
  acceptance: Array<{ id: string; text: string; status: AcceptanceStatus; evidence: string }>
  accounts: Account[]
  failovers: string[]
  linear: Array<{ at: string; text: string }>
  isComplete: boolean
}

export function snapshot(cursor: number | null): Snapshot {
  const shown = EVENTS.slice(0, cursor ?? EVENTS.length)
  const agents = new Map(AGENTS.map(agent => [agent.id, { ...agent, status: 'waiting' as AgentStatus }]))
  const acceptance = new Map(ISSUE.acceptance.map(item => [item.id, { ...item, status: 'pending' as AcceptanceStatus, evidence: 'none yet' }]))
  const accounts = new Map(ACCOUNTS.map(account => [account.slot, { ...account }]))
  const failovers: string[] = []
  const linear: Array<{ at: string; text: string }> = []
  let status: ExecutionStatus = 'queued'
  for (const event of shown) {
    if (event.status) status = event.status
    if (event.agent) {
      const agent = agents.get(event.agent.id)
      if (agent) agent.status = event.agent.status
    }
    if (event.acceptance) {
      const item = acceptance.get(event.acceptance.id)
      if (item) Object.assign(item, { status: event.acceptance.status, evidence: event.acceptance.evidence })
    }
    if (event.account) {
      const account = accounts.get(event.account.slot)
      if (account) Object.assign(account, event.account)
    }
    if (event.failover) failovers.push(event.failover)
    if (event.linear) linear.push({ at: event.at, text: event.linear })
  }
  return {
    shown,
    stage: shown.at(-1)?.stage ?? 'discover',
    status,
    agents: [...agents.values()],
    acceptance: [...acceptance.values()],
    accounts: [...accounts.values()],
    failovers,
    linear,
    isComplete: shown.length === EVENTS.length,
  }
}

/** The choice in force for a decision: the latest unreverted override, else Jev's. */
export function effectiveChoice(decision: Decision, overrides: KorOverride[]): { choice: string; override?: KorOverride } {
  const override = overrides.findLast(one => one.decisionId === decision.decisionId && !one.isReverted && one.action === 'override')
  return override ? { choice: override.choice, override } : { choice: decision.choice }
}

export function routeOf(overrides: KorOverride[]): string {
  const route = DECISIONS.find(decision => decision.decisionId === 'dec_fx_route')
  return route ? effectiveChoice(route, overrides).choice : 'none'
}

const fixture = (cells: string[], tone?: Tone, open?: KorView): Row => ({ cells, provenance: 'fixture', ...(tone ? { tone } : {}), ...(open ? { open } : {}) })

const statusTone = (status: string): Tone | undefined =>
  status === 'pass' || status === 'done' || status === 'complete' || status === 'available' || status === 'preferred'
    ? 'ok'
    : status === 'fail' || status === 'failed' || status === 'quota-limited' || status === 'blocked'
      ? 'bad'
      : status === 'pending' || status === 'waiting' || status === 'unknown' || status === 'standby'
        ? 'dim'
        : undefined

function header(snap: Snapshot, live: LiveFacts, overrides: KorOverride[]): Section {
  const stageIndex = STAGES.indexOf(snap.stage) + 1
  return {
    title: 'Execution',
    rows: [
      fixture(['Execution', `${EXECUTION.id} · ${ISSUE.id} · ${snap.status.toUpperCase()}`], snap.isComplete ? 'ok' : 'accent'),
      fixture(['Stage', `${stageIndex}/${STAGES.length} ${snap.stage} · ${snap.shown.length}/${EVENTS.length} events`]),
      fixture(['Route', routeOf(overrides)]),
      { cells: ['Claude Code', live.claudeCode], provenance: 'live' },
      { cells: ['Linear, Jev, gateway', 'not wired into the cockpit until Phases 1-5 land'], provenance: 'unavailable', tone: 'dim' },
    ],
  }
}

function decisionRows(snap: Snapshot, overrides: KorOverride[]): Row[] {
  return snap.shown.map(event => {
    const decision = event.decisionId ? DECISIONS.find(one => one.decisionId === event.decisionId) : undefined
    const choice = decision ? effectiveChoice(decision, overrides) : undefined
    const detail = choice?.override ? `${choice.choice} (override)` : (event.detail ?? '')
    return fixture([event.at, event.text, detail], decision ? 'accent' : undefined, decision ? { id: 'decision', target: decision.decisionId } : undefined)
  })
}

export function buildView(view: KorView, cursor: number | null, overrides: KorOverride[], live: LiveFacts): ViewModel {
  const snap = snapshot(cursor)
  switch (view.id) {
    case 'cockpit':
      return {
        title: 'JEV CODE cockpit',
        sections: [
          header(snap, live, overrides),
          { title: `Current issue · ${PROJECT.name} · ${ISSUE.id}`, rows: [fixture([ISSUE.title]), ...snap.agents.map(agent => fixture([agent.id, agent.status], statusTone(agent.status), { id: 'agent', target: agent.id }))] },
          { title: 'Decision stream (latest 6)', rows: decisionRows(snap, overrides).slice(-6) },
          { title: 'Subscription pool', rows: poolSummary(snap.accounts) },
          { title: 'Engineering quality', rows: snap.acceptance.map(item => fixture([item.id, item.status], statusTone(item.status))) },
        ],
      }
    case 'issue':
      return {
        title: `Issue ${ISSUE.id}`,
        sections: [
          { title: ISSUE.title, rows: [fixture(['Priority', ISSUE.priority]), fixture(['Labels', ISSUE.labels.join(', ')]), fixture(['Intent', ISSUE.intent]), fixture(['Execution', `${EXECUTION.id} · ${snap.status}`])] },
          { title: 'Acceptance conditions', rows: snap.acceptance.map(item => fixture([item.id, item.status, item.evidence], statusTone(item.status))) },
          { title: 'Next action', rows: [fixture([nextAction(snap)], 'accent')] },
        ],
      }
    case 'project':
      return {
        title: `Project ${PROJECT.name}`,
        sections: [
          { title: 'Project', rows: [fixture(['Team', PROJECT.team]), fixture(['Repository', PROJECT.repository]), fixture(['Milestone', PROJECT.milestone])] },
          { title: 'Issues', rows: PROJECT.issues.map(issue => fixture([issue.id, issue.state, issue.title, issue.note], issue.id === ISSUE.id ? 'accent' : undefined, issue.id === ISSUE.id ? { id: 'issue' } : undefined)) },
          { title: 'Documents', rows: PROJECT.documents.map(doc => fixture([doc.title, doc.purpose])) },
        ],
      }
    case 'decisions':
      return { title: 'Decision stream', sections: [{ title: `${snap.shown.length} of ${EVENTS.length} events · press a decision for its reasons`, rows: decisionRows(snap, overrides) }] }
    case 'decision':
      return decisionView(view.target, snap, overrides)
    case 'agents':
      return {
        title: 'Agents',
        sections: [{ title: `${snap.agents.filter(agent => agent.status === 'working').length} working`, rows: snap.agents.map(agent => fixture([agent.id, agent.status, agent.role], statusTone(agent.status), { id: 'agent', target: agent.id })) }],
      }
    case 'agent': {
      const agent = snap.agents.find(one => one.id === view.target)
      if (!agent) return missing(`agent ${view.target ?? '(none)'}`)
      const events = snap.shown.filter(event => event.agent?.id === agent.id)
      return {
        title: `Agent ${agent.id}`,
        sections: [
          { title: agent.role, rows: [fixture(['Status', agent.status], statusTone(agent.status)), fixture(['Worktree', EXECUTION.worktree]), fixture(['Branch', EXECUTION.branch])] },
          { title: 'Events', rows: events.length ? events.map(event => fixture([event.at, event.text, event.detail ?? ''])) : [fixture(['no events yet'], 'dim')] },
        ],
      }
    }
    case 'accounts':
      return {
        title: 'Provider accounts',
        sections: [
          { title: 'Account slots', rows: [fixture(['Provider', 'Slot', 'State', 'Route', 'Last event'], 'dim'), ...snap.accounts.map(account => fixture([account.provider, account.slot, account.state, account.route, account.lastEvent], statusTone(account.state)))] },
          { title: 'Failover', rows: snap.failovers.length ? snap.failovers.map(text => fixture([text], 'warn')) : [fixture(['none'], 'dim')] },
          { title: 'Live catalogue', rows: [{ cells: ['CLIProxyAPI catalogue and quota', 'read by the gateway adapter (Phase 4), not by this view yet'], provenance: 'unavailable', tone: 'dim' }] },
        ],
      }
    case 'context':
      return {
        title: 'Context manifest ctx_fx_01',
        sections: [
          { title: 'Sources', rows: CONTEXT.map(item => fixture([item.relevance.toFixed(2), item.source, item.purpose])) },
          { title: 'Dropped', rows: CONTEXT_DROPPED.map(item => fixture([item.source, item.reason], 'dim')) },
        ],
      }
    case 'linear':
      return {
        title: 'Linear links',
        sections: [
          { title: 'Records', rows: [fixture(['Issue', ISSUE.url]), fixture(['Project', PROJECT.url]), fixture(['Agent session', EXECUTION.session]), fixture(['Pull request', snap.linear.some(item => item.text === 'PR link attached') ? EXECUTION.pullRequest : 'not opened yet'])] },
          { title: 'Writes to Linear', rows: snap.linear.length ? snap.linear.map(item => fixture([item.at, item.text])) : [fixture(['none yet'], 'dim')] },
        ],
      }
    case 'overrides':
      return {
        title: 'Overrides',
        sections: [
          {
            title: 'Session-local; never sent to Jev, the gateway or Linear',
            rows: overrides.length
              ? overrides.map(one => fixture([one.at, one.id, one.decisionId, `${one.action}: ${one.choice}`, one.isReverted ? 'reverted' : 'active'], one.isReverted ? 'dim' : 'warn', { id: 'decision', target: one.decisionId }))
              : [fixture(['none: open a decision and press o to override'], 'dim')],
          },
        ],
      }
  }
}

function decisionView(target: string | undefined, snap: Snapshot, overrides: KorOverride[]): ViewModel {
  const decision = DECISIONS.find(one => one.decisionId === target)
  if (!decision) return missing(`decision ${target ?? '(none)'}`)
  const made = snap.shown.some(event => event.decisionId === decision.decisionId)
  const { choice, override } = effectiveChoice(decision, overrides)
  return {
    title: `Jev decision ${decision.decisionId}`,
    sections: [
      {
        title: made ? 'Decided' : 'Not reached yet in this replay',
        rows: [
          fixture(['Question', decision.question]),
          fixture(['Choice', override ? `${choice} (override ${override.id}; Jev chose ${decision.choice})` : choice], override ? 'warn' : 'accent'),
          fixture(['Confidence', decision.confidence.toFixed(2)]),
          fixture(['Candidates', decision.candidates.join(' | ')]),
        ],
      },
      { title: 'Reasons', rows: decision.reasons.map(reason => fixture([`• ${reason}`])) },
      { title: 'Evidence', rows: decision.evidenceRefs.map(ref => fixture([ref])) },
      { title: 'Policy checks', rows: decision.policyChecks.map(check => fixture([check.name, check.result], statusTone(check.result))) },
      { title: 'Actions on this decision', rows: actionRows(decision.decisionId, overrides) },
    ],
  }
}

function actionRows(decisionId: string, overrides: KorOverride[]): Row[] {
  const rows = overrides.filter(one => one.decisionId === decisionId).map(one => fixture([one.at, one.id, `${one.action}: ${one.choice}`, one.isReverted ? 'reverted' : 'active'], one.isReverted ? 'dim' : 'warn'))
  return rows.length ? rows : [fixture(['none: a apply · o override · e gather evidence · r re-evaluate'], 'dim')]
}

function poolSummary(accounts: Account[]): Row[] {
  const providers = [...new Set(accounts.map(account => account.provider))]
  return providers.map(provider => {
    const slots = accounts.filter(account => account.provider === provider)
    const available = slots.filter(account => account.state === 'available').length
    return fixture([provider, `${available} / ${slots.length} available`], available === slots.length ? 'ok' : available === 0 ? 'bad' : 'warn', { id: 'accounts' })
  })
}

function nextAction(snap: Snapshot): string {
  if (snap.isComplete) return 'none: verified outcome written to Linear'
  const pending = snap.acceptance.find(item => item.status === 'pending')
  return snap.stage === 'verify' && pending ? `evidence ${pending.id}` : `continue ${snap.stage}`
}

function missing(what: string): ViewModel {
  return { title: 'Not found', sections: [{ title: `No ${what} in the fixture`, rows: [] }] }
}

/** The one-line status the cockpit pins under the prompt. */
export function statusLine(cursor: number | null, overrides: KorOverride[], live: LiveFacts): string {
  const snap = snapshot(cursor)
  const working = snap.agents.filter(agent => agent.status === 'working').length
  const active = overrides.filter(one => !one.isReverted).length
  return [
    `[${LABEL.fixture}] Kor ${ISSUE.id}`,
    `${snap.stage} ${STAGES.indexOf(snap.stage) + 1}/${STAGES.length}`,
    snap.status,
    routeOf(overrides),
    `${working} agent${working === 1 ? '' : 's'} working`,
    ...(active ? [`${active} override${active === 1 ? '' : 's'}`] : []),
  ].join(' · ') + ` · [${LABEL.live}] CC ${live.claudeCode}`
}

/** The view as monospaced text, for headless runs and the transcript. */
export function renderText(model: ViewModel): string {
  const lines = [`${model.title}`, `Legend: [${LABEL.fixture}] fixture data · [${LABEL.live}] read from this session · [${LABEL.unavailable}] not wired yet`]
  for (const section of model.sections) {
    lines.push('', `── ${section.title}`)
    const widths = columnWidths(section.rows)
    for (const row of section.rows) lines.push(`  ${tag(row.provenance)} ${padCells(row.cells, widths)}`)
  }
  return lines.join('\n')
}

/** The provenance label, padded so it leads every row and survives truncation. */
export function tag(provenance: KorProvenance): string {
  return `[${LABEL[provenance]}]`.padEnd(14)
}

export function columnWidths(rows: Row[]): number[] {
  const widths: number[] = []
  for (const row of rows) row.cells.slice(0, -1).forEach((cell, index) => (widths[index] = Math.min(32, Math.max(widths[index] ?? 0, cell.length))))
  return widths
}

export function padCells(cells: string[], widths: number[]): string {
  return cells.map((cell, index) => (index < cells.length - 1 ? cell.padEnd(widths[index] ?? 0) : cell)).join('  ')
}

export function parseView(args: string): KorView | undefined {
  const [name = 'cockpit', target] = args.trim().split(/\s+/).filter(Boolean)
  const id = VIEWS.find(view => view.id === name || view.label.toLowerCase() === name)?.id ?? (name === 'decision' || name === 'agent' ? name : undefined)
  if (!id) return undefined
  return target ? { id, target } : { id }
}
