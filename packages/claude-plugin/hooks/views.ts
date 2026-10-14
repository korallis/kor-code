// Builds every cockpit view as plain rows, each carrying its provenance, so
// the pane and the text output draw the same values with the same labels.
// The views know nothing of where the data came from: the demo and the live
// reader both hand them a CockpitData (model.ts).

import type { KorProvenance, KorView, KorViewId } from '../types'
import { STAGES, type CockpitData, type Decision, type Part } from './model'

export type Tone = 'ok' | 'warn' | 'bad' | 'dim' | 'accent'
export type Row = { cells: string[]; provenance: KorProvenance; tone?: Tone; open?: KorView }
export type Section = { title: string; rows: Row[] }
export type ViewModel = { title: string; sections: Section[] }

/** What the session itself reports; always drawn as live. */
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

const row = (part: Part<unknown>, cells: string[], tone?: Tone, open?: KorView): Row => ({ cells, provenance: part.provenance, ...(tone ? { tone } : {}), ...(open ? { open } : {}) })

/** The rows of a part, or one row saying why there are none. */
function rowsOf<T>(part: Part<T>, build: (value: T) => Row[], empty: string): Row[] {
  if (part.provenance === 'unavailable') return [{ cells: [part.why ?? 'not reported by the daemon'], provenance: 'unavailable', tone: 'dim' }]
  const rows = build(part.value)
  return rows.length ? rows : [row(part, [empty], 'dim')]
}

/** A section title with the age of a stale part, so the label says how old it is. */
function titled(title: string, part: Part<unknown>): string {
  if (part.provenance !== 'stale' || !part.age) return title
  // The daemon-unreachable reason is the legend's; any other reason (a failed gateway read) is the section's own.
  return `${title} · stale, observed ${part.age} ago${part.why && !part.why.startsWith('daemon did not answer') && !part.why.startsWith('older than') ? ` (${part.why})` : ''}`
}

export const statusTone = (status: string): Tone | undefined =>
  ['pass', 'done', 'complete', 'completed', 'available', 'preferred', 'applied', 'merged'].includes(status)
    ? 'ok'
    : ['fail', 'failed', 'quota', 'quota-limited', 'blocked', 'rejected', 'escalated', 'authentication', 'unavailable'].includes(status)
      ? 'bad'
      : ['pending', 'waiting', 'unknown', 'standby', 'reverted', 'queued'].includes(status)
        ? 'dim'
        : undefined

function header(data: CockpitData, live: LiveFacts): Section {
  const { execution, issue, events } = data
  const exec = execution.value
  const stageIndex = exec ? STAGES.indexOf(exec.stage as (typeof STAGES)[number]) + 1 : 0
  const progress = data.replay ? ` · ${data.replay.shown}/${data.replay.total} events` : ''
  return {
    title: titled('Execution', execution),
    rows: [
      ...rowsOf(execution, value => (value ? [
        row(execution, ['Execution', `${value.id} · ${issue.value?.id ?? '?'} · ${value.status.toUpperCase()}`], value.status === 'complete' ? 'ok' : statusTone(value.status) ?? 'accent', { id: 'issue' }),
        row(execution, ['Stage', `${stageIndex > 0 ? `${stageIndex}/${STAGES.length} ` : ''}${value.stage}${progress}`]),
        row(execution, ['Route', `${value.route}${value.routeSource && value.routeSource !== 'jev' ? ` (${value.routeSource})` : ''}`], value.routeSource === 'fallback' ? 'warn' : undefined, { id: 'decisions' }),
        ...(value.updatedAt ? [row(execution, ['Updated', value.updatedAt])] : []),
        ...(value.error ? [row(execution, ['Last error', value.error], 'bad')] : []),
      ] : []), 'no execution: the daemon has not picked up an issue'),
      ...(events.provenance === 'unavailable' && execution.provenance !== 'unavailable' ? [row(events, ['Events', events.why ?? 'not reported'], 'dim')] : []),
      { cells: ['Claude Code', live.claudeCode], provenance: 'live' },
    ],
  }
}

function decisionRows(data: CockpitData): Row[] {
  const { events, decisions } = data
  return rowsOf(events, list => list.map(event => {
    const decision = event.decisionId ? decisions.value.find(one => one.decisionId === event.decisionId) : undefined
    const detail = decision?.source?.startsWith('override') ? `${decision.choice} (override)` : (event.detail ?? '')
    return row(events, [event.at, event.text, detail], decision ? 'accent' : undefined, decision ? { id: 'decision', target: decision.decisionId } : undefined)
  }), 'no events yet')
}

export function buildView(view: KorView, data: CockpitData, live: LiveFacts): ViewModel {
  const { execution, issue, project, decisions, agents, acceptance, accounts, failovers, context, linear, overrides, queue } = data
  const issueId = issue.value?.id ?? 'no issue'
  switch (view.id) {
    case 'cockpit':
      return {
        title: data.mode === 'demo' ? 'KOR CODE cockpit · demo' : 'KOR CODE cockpit',
        sections: [
          header(data, live),
          {
            title: titled(['Current issue', project.value?.name, issue.value?.id].filter(Boolean).join(' · '), issue),
            rows: [
              ...rowsOf(issue, value => (value ? [row(issue, [value.title], undefined, { id: 'issue' })] : []), 'no current issue'),
              ...rowsOf(agents, list => list.map(agent => row(agents, [agent.id, agent.status], statusTone(agent.status), { id: 'agent', target: agent.id })), 'no agents reported'),
            ],
          },
          { title: titled('Decision stream (latest 6)', data.events), rows: decisionRows(data).slice(-6) },
          { title: titled('Subscription pool', accounts), rows: rowsOf(accounts, () => poolSummary(data), 'no account slots reported') },
          { title: titled('Engineering quality', acceptance), rows: rowsOf(acceptance, list => list.map(item => row(acceptance, [item.id, item.status], statusTone(item.status))), 'no acceptance conditions') },
        ],
      }
    case 'issue':
      return {
        title: `Issue ${issueId}`,
        sections: [
          {
            title: titled(issue.value?.title ?? 'Issue', issue),
            rows: rowsOf(issue, value => (value ? [
              row(issue, ['State', value.state]),
              row(issue, ['Priority', value.priority]),
              row(issue, ['Labels', value.labels.join(', ') || 'none']),
              row(issue, ['Intent', value.intent]),
              row(issue, ['Link', value.url]),
              ...(execution.value ? [row(execution, ['Execution', `${execution.value.id} · ${execution.value.status} · attempt ${execution.value.attempts}`])] : []),
            ] : []), 'no current issue'),
          },
          { title: titled('Acceptance conditions', acceptance), rows: rowsOf(acceptance, list => list.map(item => row(acceptance, [item.id, item.status, item.evidence], statusTone(item.status))), 'no acceptance conditions') },
          { title: 'Next action', rows: [nextAction(data)] },
        ],
      }
    case 'project':
      return {
        title: `Project ${project.value?.name ?? ''}`.trim(),
        sections: [
          {
            title: titled('Project', project),
            rows: rowsOf(project, value => (value ? [row(project, ['Team', value.team]), row(project, ['Repository', value.repository]), ...(value.milestone ? [row(project, ['Milestone', value.milestone])] : [])] : []), 'no project mapped'),
          },
          {
            title: titled('Issues', project),
            rows: rowsOf(project, value => (value?.issues ?? []).map(one => row(project, [one.id, one.state, one.title, one.note], one.id === issue.value?.id ? 'accent' : undefined, one.id === issue.value?.id ? { id: 'issue' } : undefined)), 'no issues listed'),
          },
          {
            title: titled('Executions', queue),
            rows: rowsOf(queue, list => list.filter(one => one.id).map(one => row(queue, [one.id, one.issueId, one.status, one.route, one.updatedAt], statusTone(one.status))), 'no executions recorded'),
          },
          ...(project.value?.documents.length ? [{ title: titled('Documents', project), rows: project.value.documents.map(doc => row(project, [doc.title, doc.purpose])) }] : []),
        ],
      }
    case 'decisions':
      return { title: 'Decision stream', sections: [{ title: titled(`${data.replay ? `${data.replay.shown} of ${data.replay.total}` : data.events.value.length} events · press a decision for its reasons`, data.events), rows: decisionRows(data) }] }
    case 'decision':
      return decisionView(view.target, data)
    case 'agents':
      return {
        title: 'Agents',
        sections: [{ title: titled(`${agents.value.filter(agent => agent.status === 'working').length} working`, agents), rows: rowsOf(agents, list => list.map(agent => row(agents, [agent.id, agent.status, agent.role], statusTone(agent.status), { id: 'agent', target: agent.id })), 'no agents reported') }],
      }
    case 'agent': {
      const agent = agents.value.find(one => one.id === view.target)
      if (!agent) return missing(`agent ${view.target ?? '(none)'}`, data)
      const shown = data.events.value.filter(event => event.agentId === agent.id)
      return {
        title: `Agent ${agent.id}`,
        sections: [
          { title: titled(agent.role, agents), rows: [row(agents, ['Status', agent.status], statusTone(agent.status)), ...(execution.value ? [row(execution, ['Worktree', execution.value.worktree]), row(execution, ['Branch', execution.value.branch])] : [])] },
          { title: titled('Events', data.events), rows: rowsOf(data.events, () => shown.map(event => row(data.events, [event.at, event.text, event.detail ?? ''])), 'no events yet') },
        ],
      }
    }
    case 'accounts':
      return {
        title: 'Provider accounts',
        sections: [
          {
            title: titled('Account slots', accounts),
            rows: rowsOf(accounts, list => (list.length ? [row(accounts, ['Provider', 'Slot', 'State', 'Route', 'Last event'], 'dim'), ...list.map(account => row(accounts, [account.provider, account.slot, account.state, account.route, account.lastEvent], statusTone(account.state)))] : []), 'no account slots reported'),
          },
          { title: titled('Failover', failovers), rows: rowsOf(failovers, list => list.map(text => row(failovers, [text], 'warn')), 'none') },
        ],
      }
    case 'context':
      return {
        title: 'Context manifest',
        sections: [
          { title: titled('Sources', context), rows: rowsOf(context, value => value.sources.map(item => row(context, [item.relevance.toFixed(2), item.source, item.purpose])), 'no context manifest recorded') },
          { title: titled('Dropped', context), rows: rowsOf(context, value => value.dropped.map(item => row(context, [item.source, item.reason], 'dim')), 'none dropped') },
        ],
      }
    case 'linear':
      return {
        title: 'Linear links',
        sections: [
          { title: titled('Records', linear), rows: rowsOf(linear, value => value.records.map(record => row(linear, [record.name, record.value])), 'no Linear records') },
          { title: titled('Writes to Linear', linear), rows: rowsOf(linear, value => value.writes.map(item => row(linear, [item.at, item.text])), 'none yet') },
        ],
      }
    case 'overrides':
      return {
        title: 'Overrides',
        sections: [
          {
            title: titled(data.overridePath, overrides),
            rows: rowsOf(overrides, list => list.map(one => row(overrides, [one.at, one.id, one.decisionId, `${one.action}: ${one.choice}`, one.status, one.detail], statusTone(one.status) ?? 'warn', { id: 'decision', target: one.decisionId })), 'none: open a decision and press o, or /kor override route <model>'),
          },
        ],
      }
  }
}

function decisionView(target: string | undefined, data: CockpitData): ViewModel {
  const { decisions, overrides } = data
  const decision: Decision | undefined = decisions.value.find(one => one.decisionId === target || one.kind === target)
  if (!decision) return missing(`decision ${target ?? '(none)'}`, data)
  const made = data.events.value.some(event => event.decisionId === decision.decisionId) || data.mode === 'live'
  const overridden = decision.source?.startsWith('override')
  const actions = overrides.value.filter(one => one.decisionId === decision.decisionId)
  return {
    title: `Jev decision ${decision.decisionId}`,
    sections: [
      {
        title: titled(made ? 'Decided' : 'Not reached yet in this replay', decisions),
        rows: [
          row(decisions, ['Question', decision.question]),
          row(decisions, ['Choice', decision.source && decision.source !== 'jev' ? `${decision.choice} (${decision.source})` : decision.choice], overridden || decision.source === 'fallback' ? 'warn' : 'accent'),
          row(decisions, ['Confidence', decision.confidence.toFixed(2)]),
          row(decisions, ['Candidates', decision.candidates.join(' | ') || 'none recorded']),
        ],
      },
      { title: titled('Reasons', decisions), rows: decision.reasons.length ? decision.reasons.map(reason => row(decisions, [`• ${reason}`])) : [row(decisions, ['none recorded'], 'dim')] },
      { title: titled('Evidence', decisions), rows: decision.evidenceRefs.length ? decision.evidenceRefs.map(ref => row(decisions, [ref])) : [row(decisions, ['none recorded'], 'dim')] },
      { title: titled('Policy checks', decisions), rows: decision.policyChecks.length ? decision.policyChecks.map(check => row(decisions, [check.name, check.result], statusTone(check.result))) : [row(decisions, ['none recorded'], 'dim')] },
      {
        title: titled('Actions on this decision', overrides),
        rows: rowsOf(overrides, () => actions.map(one => row(overrides, [one.at, one.id, `${one.action}: ${one.choice}`, one.status], statusTone(one.status) ?? 'warn')), data.mode === 'demo' ? 'none: a apply · o override · e gather evidence · r re-evaluate' : 'none: /kor override <decision|route> <choice> sends one to the daemon'),
      },
    ],
  }
}

function poolSummary(data: CockpitData): Row[] {
  const { accounts } = data
  const providers = [...new Set(accounts.value.map(account => account.provider))]
  return providers.map(provider => {
    const slots = accounts.value.filter(account => account.provider === provider)
    const available = slots.filter(account => account.state === 'available').length
    return row(accounts, [provider, `${available} / ${slots.length} available`], available === slots.length ? 'ok' : available === 0 ? 'bad' : 'warn', { id: 'accounts' })
  })
}

function nextAction(data: CockpitData): Row {
  const { execution, acceptance } = data
  const exec = execution.value
  if (!exec) return row(execution, [execution.provenance === 'unavailable' ? 'start the daemon: kor serve' : 'label a Todo issue kor, or run kor run <issue>'], 'accent')
  if (['complete', 'review'].includes(exec.status)) return row(execution, [exec.pullRequest ? `review ${exec.pullRequest}` : 'none: verified outcome written to Linear'], 'accent')
  if (['blocked', 'escalated', 'failed'].includes(exec.status)) return row(execution, [`answer Kor on ${data.issue.value?.url ?? 'the issue'}`], 'bad')
  const pending = acceptance.value.find(item => item.status === 'pending')
  return row(execution, [exec.stage === 'verify' && pending ? `evidence ${pending.id}` : `continue ${exec.stage}`], 'accent')
}

function missing(what: string, data: CockpitData): ViewModel {
  return { title: 'Not found', sections: [{ title: `No ${what} in the ${data.mode === 'demo' ? 'fixture' : 'daemon status'}`, rows: [] }] }
}

/** The one-line status the cockpit pins under the prompt. */
export function statusLine(data: CockpitData, live: LiveFacts): string {
  const { execution, issue, agents, overrides } = data
  const exec = execution.value
  const label = execution.provenance === 'stale' && execution.age ? `${LABEL.stale} ${execution.age}` : LABEL[execution.provenance]
  const active = overrides.value.filter(one => one.status === 'active' || one.status === 'applied').length
  const working = agents.value.filter(agent => agent.status === 'working').length
  const parts = exec
    ? [
        `[${label}] Kor ${issue.value?.id ?? exec.id}`,
        `${exec.stage} ${STAGES.indexOf(exec.stage as (typeof STAGES)[number]) + 1}/${STAGES.length}`,
        exec.status,
        exec.routeSource && exec.routeSource !== 'jev' ? `${exec.route} (${exec.routeSource.split(' ')[0]})` : exec.route,
        ...(data.mode === 'demo' ? [`${working} agent${working === 1 ? '' : 's'} working`] : []),
        ...(active ? [`${active} override${active === 1 ? '' : 's'}`] : []),
      ]
    : [`[${label}] Kor`, execution.provenance === 'unavailable' ? 'daemon down: /kor for why' : 'idle: no execution']
  return `${parts.join(' · ')} · [${LABEL.live}] CC ${live.claudeCode}`
}

/** The legend under every view title: what each label means in this mode. */
export function legend(data: CockpitData): string {
  return data.mode === 'demo'
    ? `Legend: [${LABEL.fixture}] demo fixture · [${LABEL.live}] read from this session`
    : `Legend: [${LABEL.live}] daemon, fresh · [${LABEL.stale}] last known, with its age · [${LABEL.unavailable}] not reported or daemon down · source ${data.origin}`
}

/** The view as monospaced text, for headless runs and the transcript. */
export function renderText(model: ViewModel, data: CockpitData): string {
  const lines = [`${model.title}`, legend(data)]
  for (const section of model.sections) {
    lines.push('', `── ${section.title}`)
    const widths = columnWidths(section.rows)
    for (const one of section.rows) lines.push(`  ${tag(one.provenance)} ${padCells(one.cells, widths)}`)
  }
  return lines.join('\n')
}

/** The provenance label, padded so it leads every row and survives truncation. */
export function tag(provenance: KorProvenance): string {
  return `[${LABEL[provenance]}]`.padEnd(14)
}

export function columnWidths(rows: Row[]): number[] {
  const widths: number[] = []
  for (const one of rows) one.cells.slice(0, -1).forEach((cell, index) => (widths[index] = Math.min(32, Math.max(widths[index] ?? 0, cell.length))))
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
