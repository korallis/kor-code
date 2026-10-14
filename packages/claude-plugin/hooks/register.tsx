// The Kor Code cockpit mod: a pinned status line, the /kor views in a pane,
// and /kor-status as the sandbox's deterministic load proof. `/kor` draws the
// daemon's live status (live.ts); `/kor demo` draws the fixture execution.
// Live overrides go to the daemon, which checks policy, audits and comments
// on Linear; the cockpit itself writes no settings, files or remote records.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { installationPilot } from './install-scope'

import type { KorOverride, KorProvenance, KorView } from '../types'
import { DECISIONS, demoChoice, demoData, EVENTS } from './fixture'
import { fetchStatus, fromStatus, liveSource, type LiveSource } from './live'
import type { CockpitData } from './model'
import { buildView, columnWidths, LABEL, legend, padCells, parseView, renderText, statusLine, tag, VIEWS, type LiveFacts, type Tone } from './views'

const PANE = 'kor-cockpit'
const view = atom({ plugin: 'kor-code-cockpit', key: 'view' } as const, { id: 'cockpit' })
const mode = atom({ plugin: 'kor-code-cockpit', key: 'mode' } as const, 'live')
const cursor = atom({ plugin: 'kor-code-cockpit', key: 'cursor' } as const, null)
const overrides = atom({ plugin: 'kor-code-cockpit', key: 'overrides' } as const, [])

const TAG_COLOR: Record<KorProvenance, string> = { live: 'success', stale: 'warning', fixture: 'suggestion', unavailable: 'inactive' }
const TONE_COLOR: Record<Tone, string> = { ok: 'success', warn: 'warning', bad: 'error', dim: 'inactive', accent: 'suggestion' }
const ACTIONS = [
  { action: 'apply', label: 'Apply', hotkey: 'a' },
  { action: 'override', label: 'Override', hotkey: 'o' },
  { action: 'evidence', label: 'Gather evidence', hotkey: 'e' },
  { action: 'reevaluate', label: 'Re-evaluate', hotkey: 'r' },
] as const
const VIEW_NAMES = 'cockpit|issue|project|decisions|decision <id>|agents|agent <id>|accounts|context|linear|overrides'
const USAGE = [
  `Usage: /kor [${VIEW_NAMES}]`,
  '       /kor override <decision|route> <choice>   sent to the daemon: policy-checked, audited, commented on Linear',
  '       /kor revert <override>',
  `       /kor demo [${VIEW_NAMES}|replay|apply|override|evidence|reevaluate <decision> [choice]|revert <override>]`,
].join('\n')
/** How often the status line and an open pane re-read the daemon. */
const POLL_MS = 5000
/** How long a status read waits before the daemon counts as not answering. */
const STATUS_TIMEOUT_MS = 2000

let replay: Timer | undefined
let poll: Timer | undefined
/** The last live read; the pane draws it, the poll refreshes it. */
let latest: CockpitData | undefined

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

/** Keep execution sessions from mutating remotes or destroying their worktree. */
function policyDecision(toolName: string, input: unknown): string | undefined {
  if (toolName !== 'Bash') return undefined
  const command = object(input)?.command
  if (typeof command !== 'string') return undefined
  const blocked = [
    /(?:^|\s)git\s+push(?:\s|$)/,
    /(?:^|\s)git\s+reset\s+--hard(?:\s|$)/,
    /(?:^|\s)git\s+clean\s+-[^\n]*f/,
    /(?:^|\s)git\s+branch\s+-D(?:\s|$)/,
    /(?:^|\s)rm\s+-[^\n]*r[^\n]*f/,
  ].some(pattern => pattern.test(command))
  return blocked ? 'Kor policy denied a destructive or remote-mutating command.' : undefined
}

/** Inherited local settings must not activate Kor in a linked worktree. */
async function active($: EngineInterface): Promise<boolean> {
  if ((await $.env.get('KOR_COCKPIT')) === 'off') return false
  if (installationPilot === undefined) return true
  const directory = await $.fs.stat(await $.session.cwd(), { resolve: true }).catch(() => undefined)
  return directory?.realPath === installationPilot
}

async function liveFacts($: EngineInterface): Promise<LiveFacts> {
  return { claudeCode: (await $.session.version()).version }
}

async function source($: EngineInterface): Promise<LiveSource> {
  return liveSource({
    statusUrl: await $.env.get('KOR_STATUS_URL'),
    stateDir: await $.env.get('KOR_STATE_DIR'),
    xdgStateHome: await $.env.get('XDG_STATE_HOME'),
    home: await $.env.get('HOME'),
  })
}

/** Reads the daemon now and keeps the result for the pane. */
async function readLive($: EngineInterface): Promise<CockpitData> {
  const fetched = await fetchStatus(await source($), {
    // The host's fetch can wait about 30 s on a closed loopback port; a daemon answers in milliseconds.
    fetch: url => Promise.race([$.http.fetch(url), $.clock.sleep(STATUS_TIMEOUT_MS).then(() => Promise.reject(new Error('status timeout')))]),
    read: path => $.fs.read(path),
  })
  latest = fromStatus(fetched, await $.clock.now())
  return latest
}

async function data($: EngineInterface, fresh = false): Promise<CockpitData> {
  if ((await read($, mode)) === 'demo') return demoData(await read($, cursor), await read($, overrides))
  return !fresh && latest ? latest : readLive($)
}

async function refreshStatus($: EngineInterface, fresh = false): Promise<void> {
  if (!await active($)) return
  $.ui.status(statusLine(await data($, fresh), await liveFacts($)))
}

async function show($: EngineInterface, next: KorView, nextMode?: 'live' | 'demo'): Promise<void> {
  if (nextMode) await update($, mode, () => nextMode)
  await update($, view, () => next)
}

/** A demo action: a session-local record on a fixture decision. */
async function demoAct($: EngineInterface, action: KorOverride['action'], decisionId: string, wanted?: string): Promise<string> {
  const decision = DECISIONS.find(one => one.decisionId === decisionId || one.kind === decisionId)
  if (!decision) return `No decision ${decisionId} in the fixture.`
  const list = await read($, overrides)
  const current = demoChoice(decision, list).choice
  const choice = action === 'override' ? (wanted ?? decision.candidates[(decision.candidates.indexOf(current) + 1) % decision.candidates.length] ?? current) : current
  if (action === 'override' && !decision.candidates.includes(choice)) return `${choice} is not a candidate of ${decision.decisionId}: ${decision.candidates.join(' | ')}`
  const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
  const record: KorOverride = { id: `ovr_${list.length + 1}`, decisionId: decision.decisionId, action, choice, at, isReverted: false }
  await update($, overrides, all => [...all, record])
  await refreshStatus($)
  return `${record.id}: ${action} ${decision.decisionId} → ${choice} [${LABEL.fixture}; demo, session-local, not sent to the daemon, Jev, the gateway or Linear]`
}

async function demoRevert($: EngineInterface, id: string): Promise<string> {
  const list = await read($, overrides)
  const record = list.find(one => one.id === id)
  if (!record) return `No demo override ${id}.`
  if (record.isReverted) return `${id} is already reverted.`
  await update($, overrides, all => all.map(one => (one.id === id ? { ...one, isReverted: true } : one)))
  await refreshStatus($)
  return `${id} reverted; ${record.decisionId} is back to ${demoChoice(DECISIONS.find(one => one.decisionId === record.decisionId)!, await read($, overrides)).choice} [${LABEL.fixture}]`
}

/** The daemon's base URL: the status URL without its last path segment. */
function daemonBase(live: LiveSource): string | undefined {
  return live.statusUrl?.replace(/\/[^/]*$/, '')
}

/**
 * Sends an override to the daemon. The daemon applies it only when policy
 * permits, records it in the audit and comments on the Linear issue; the
 * cockpit shows the daemon's answer and never applies anything itself.
 */
async function liveOverride($: EngineInterface, target: string, choice: string | undefined): Promise<{ text: string; exitCode?: number }> {
  const live = await source($)
  const base = daemonBase(live)
  if (!base) return { text: `[${LABEL.unavailable}] overrides need the daemon; KOR_STATUS_URL is off.`, exitCode: 1 }
  const current = await readLive($)
  const decision = current.decisions.value.find(one => one.decisionId === target || one.kind === target)
  const executionId = current.execution.value?.id
  if (current.execution.provenance !== 'live' || !executionId) return { text: `[${LABEL[current.execution.provenance]}] no live execution to override (${current.execution.why ?? 'the daemon reports none'}).`, exitCode: 1 }
  // A live override always names its choice (Jev 0.88): nothing is guessed on the user's behalf.
  const wanted = choice
  if (!wanted) return { text: `Usage: /kor override <decision|route> <choice>${decision ? `; ${decision.decisionId} candidates: ${decision.candidates.join(' | ')}` : ''}`, exitCode: 2 }
  const body = JSON.stringify({ executionId, ...(decision ? { decisionId: decision.decisionId } : {}), target, choice: wanted, origin: 'cockpit' })
  try {
    const response = await $.http.fetch(`${base}/overrides`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const answer = object(JSON.parse(response.text || '{}')) ?? {}
    await readLive($)
    $.ui.invalidate('ui.render')
    await refreshStatus($)
    const detail = [answer.id ? `${String(answer.id)}:` : '', `${target} → ${wanted}`, String(answer.status ?? (response.ok ? 'applied' : 'rejected')), answer.reason ? `(${String(answer.reason)})` : '', answer.auditId ? `audit ${String(answer.auditId)}` : '', answer.linearCommentId ? 'Linear comment queued' : ''].filter(Boolean).join(' ')
    return response.ok ? { text: `[${LABEL.live}] ${detail}` } : { text: `[${LABEL.live}] daemon refused: ${detail}`, exitCode: 1 }
  } catch {
    return { text: `[${LABEL.unavailable}] the daemon did not answer at ${base}/overrides; nothing was applied.`, exitCode: 1 }
  }
}

async function liveRevert($: EngineInterface, id: string): Promise<{ text: string; exitCode?: number }> {
  const base = daemonBase(await source($))
  if (!base) return { text: `[${LABEL.unavailable}] overrides need the daemon; KOR_STATUS_URL is off.`, exitCode: 1 }
  try {
    const response = await $.http.fetch(`${base}/overrides/${encodeURIComponent(id)}/revert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 'cockpit' }) })
    const answer = object(JSON.parse(response.text || '{}')) ?? {}
    await readLive($)
    $.ui.invalidate('ui.render')
    await refreshStatus($)
    return { text: `[${LABEL.live}] ${id} ${String(answer.status ?? (response.ok ? 'reverted' : 'refused'))}${answer.reason ? ` (${String(answer.reason)})` : ''}`, ...(response.ok ? {} : { exitCode: 1 }) }
  } catch {
    return { text: `[${LABEL.unavailable}] the daemon did not answer at ${base}; nothing was reverted.`, exitCode: 1 }
  }
}

async function startReplay($: EngineInterface): Promise<void> {
  replay?.cancel()
  await update($, mode, () => 'demo')
  await update($, cursor, () => 0)
  await refreshStatus($)
  replay = $.clock.every(1500, async () => {
    const shown = await read($, cursor)
    const nextCursor = shown === null || shown + 1 >= EVENTS.length ? null : shown + 1
    await update($, cursor, () => nextCursor)
    await refreshStatus($)
    if (nextCursor === null) replay?.cancel()
  })
}

/** Every replay frame as text: the headless proof that the execution is visible end to end. */
async function replayText($: EngineInterface): Promise<string> {
  const list = await read($, overrides)
  const live = await liveFacts($)
  const frames = EVENTS.map((event, index) => `${String(index + 1).padStart(2)}. ${event.at} ${event.stage.padEnd(11)} ${event.text}\n    status line: ${statusLine(demoData(index + 1, list), live)}`)
  const final = demoData(null, list)
  return [`Replay of ${EVENTS.length} fixture events [${LABEL.fixture}]`, ...frames, '', renderText(buildView({ id: 'cockpit' }, final, live), final)].join('\n')
}

/** `/kor demo …`: the fixture execution, with session-local actions. */
async function demo($: EngineInterface, args: string[], isHeadless: boolean): Promise<{ text: string; exitCode?: number }> {
  const [verb = '', first, ...rest] = args
  if (verb === 'replay') {
    if (isHeadless) return { text: await replayText($) }
    await show($, { id: 'cockpit' }, 'demo')
    await $.ui.open({ id: PANE, title: 'Kor cockpit', focus: true, rows: 48 })
    await startReplay($)
    return { text: `Replaying ${EVENTS.length} fixture events in the Kor cockpit pane and status line [${LABEL.fixture}].` }
  }
  if (verb === 'revert') return first ? { text: await demoRevert($, first) } : { text: USAGE, exitCode: 2 }
  const action = ACTIONS.find(one => one.action === verb)?.action
  if (action) return first ? { text: await demoAct($, action, first, rest.length ? rest.join(' ') : undefined) } : { text: USAGE, exitCode: 2 }
  const target = parseView(args.join(' '))
  if (!target) return { text: USAGE, exitCode: 2 }
  await show($, target, 'demo')
  await refreshStatus($)
  const shown = demoData(await read($, cursor), await read($, overrides))
  if (isHeadless) return { text: renderText(buildView(target, shown, await liveFacts($)), shown) }
  await $.ui.open({ id: PANE, title: 'Kor cockpit', focus: true, rows: 48 })
  return { text: `Kor cockpit demo: ${target.id}${target.target ? ` ${target.target}` : ''} [${LABEL.fixture} data]` }
}

/** Re-reads the daemon on a timer while the session runs, so labels age honestly. */
function startPoll($: EngineInterface): void {
  poll?.cancel()
  poll = $.clock.every(POLL_MS, async () => {
    if (!await active($)) return
    if ((await read($, mode)) === 'demo') return
    await readLive($)
    $.ui.invalidate('ui.render')
    await refreshStatus($)
  })
}

export const register: Register = on => {
  on('classic.PreToolUse', async ($, e, next) => {
    if (!await active($)) return next(e)
    const reason = policyDecision(e.tool, e)
    return reason ? { deny: reason } : next(e)
  }).catch(() => ({ deny: 'Kor policy hook failed closed.' }))

  on('session.start', async ($, e, next) => {
    if (!await active($)) return next(e)
    await $.command.register({ name: 'kor', description: 'Kor Code cockpit: live daemon status; /kor demo for the fixture', argumentHint: '[view] [id] | override <decision> <choice> | demo …' })
    await $.command.register({ name: 'kor-status', description: 'Show the Kor Code cockpit status line' })
    // The first read must not hold the session's start while a stopped daemon times out.
    void refreshStatus($, true)
    if ((await $.env.get('KOR_COCKPIT')) !== 'off') startPoll($)
    return next(e)
  })

  on('command.run', { command: 'kor-status' }, async ($, e, next) => {
    if (!await active($)) return next(e)
    const line = statusLine(await data($, true), await liveFacts($))
    return { text: `Kor Code cockpit plugin loaded (session-local; no configuration changes).\n${line}`, exitCode: 0 }
  })

  on('command.run', { command: 'kor' }, async ($, e, next) => {
    if (!await active($)) return next(e)
    const isHeadless = e.origin.kind === 'sdk'
    const args = e.args.trim().split(/\s+/).filter(Boolean)
    const [verb = '', first, ...rest] = args
    if (verb === 'demo') return demo($, args.slice(1), isHeadless)
    if (verb === 'override') return first ? liveOverride($, first, rest.length ? rest.join(' ') : undefined) : { text: USAGE, exitCode: 2 }
    if (verb === 'revert') return first ? liveRevert($, first) : { text: USAGE, exitCode: 2 }
    const target = parseView(e.args)
    if (!target) return { text: USAGE, exitCode: 2 }
    replay?.cancel()
    await show($, target, 'live')
    const current = await readLive($)
    await refreshStatus($)
    if (isHeadless) return { text: renderText(buildView(target, current, await liveFacts($)), current) }
    await $.ui.open({ id: PANE, title: 'Kor cockpit', focus: true, rows: 48 })
    return { text: `Kor cockpit: ${target.id}${target.target ? ` ${target.target}` : ''} [${LABEL[current.execution.provenance]} from ${current.origin}]` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!await active($)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, view)
    const isDemo = (await read($, mode)) === 'demo'
    const shown = await read($, cursor)
    const model = await data($)
    const built = buildView(current, model, await liveFacts($))
    const columns = e.props.bodyColumns
    const headline = model.execution
    const badge = isDemo ? ` ${LABEL.fixture} DEMO ` : ` ${headline.provenance === 'stale' && headline.age ? `${LABEL.stale} ${headline.age}` : LABEL[headline.provenance]} `

    const nav = (
      <Box flexWrap="wrap" columnGap={1}>
        {VIEWS.map(one => (
          <Button key={`nav-${one.id}`} label={one.label} hotkey={one.hotkey} plain variant={one.id === current.id ? 'primary' : 'secondary'} onPress={() => show($, { id: one.id })} />
        ))}
        {isDemo ? (
          <Button key="replay" label={shown === null ? 'Replay' : `Replaying ${shown}/${EVENTS.length}`} hotkey="p" plain onPress={() => startReplay($)} />
        ) : (
          <Button key="refresh" label="Refresh" hotkey="f" plain onPress={() => readLive($).then(() => $.ui.invalidate('ui.render'))} />
        )}
        <Button key="mode" label={isDemo ? 'Live' : 'Demo'} hotkey="m" plain onPress={() => { replay?.cancel(); return show($, current, isDemo ? 'live' : 'demo').then(() => refreshStatus($, true)) }} />
        <Button key="close" label="Close" hotkey="q" plain role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )

    const sections = built.sections.map((section, sectionIndex) => {
      const widths = columnWidths(section.rows)
      return (
        <Box key={`section-${sectionIndex}`} flexDirection="column" marginTop={1}>
          <Text bold color="claude" wrap="truncate-end">── {section.title}</Text>
          {section.rows.map((row, rowIndex) => {
            const label = <Text color={TAG_COLOR[row.provenance]}>{tag(row.provenance)}</Text>
            const body = padCells(row.cells, widths)
            const color = row.tone ? TONE_COLOR[row.tone] : undefined
            const destination = row.open
            return destination ? (
              <Button key={`row-${sectionIndex}-${rowIndex}`} plain onPress={() => show($, destination)}>
                {label}
                <Text color={color ?? 'suggestion'} underline>{body.slice(0, Math.max(10, columns - 14))}</Text>
              </Button>
            ) : (
              <Box key={`row-${sectionIndex}-${rowIndex}`}>
                {label}
                <Text color={color} dimColor={row.tone === 'dim'} wrap="truncate-end">{body}</Text>
              </Box>
            )
          })}
        </Box>
      )
    })

    const decision = current.id === 'decision' ? model.decisions.value.find(one => one.decisionId === current.target) : undefined
    const drill = decision ? (
      <Box columnGap={1} marginTop={1} flexWrap="wrap">
        {isDemo
          ? ACTIONS.map(one => (
              <Button key={`act-${one.action}`} label={one.label} hotkey={one.hotkey} plain onPress={() => demoAct($, one.action, decision.decisionId).then(text => $.ui.toast(text))} />
            ))
          : decision.candidates.filter(one => one !== decision.choice).map(candidate => (
              <Button key={`override-${candidate}`} label={`Override → ${candidate}`} plain onPress={() => liveOverride($, decision.decisionId, candidate).then(result => $.ui.toast(result.text))} />
            ))}
        <Button key="back" label="Back" hotkey="b" plain onPress={() => show($, { id: 'decisions' })} />
      </Box>
    ) : null

    const reverts = current.id === 'overrides' || current.id === 'decision'
      ? model.overrides.value.filter(one => ['active', 'applied'].includes(one.status) && (current.id === 'overrides' || one.decisionId === current.target))
      : []

    return (
      <Box flexDirection="column" width={columns}>
        <Box columnGap={1}>
          <Text bold>{built.title}</Text>
          <Text color={isDemo ? 'suggestion' : TAG_COLOR[headline.provenance]} inverse>{badge}</Text>
          {isDemo && shown !== null && <Text color="suggestion">replay {shown}/{EVENTS.length}</Text>}
        </Box>
        <Text dimColor wrap="truncate-end">{legend(model)}</Text>
        {nav}
        {sections}
        {drill}
        {reverts.length > 0 && (
          <Box columnGap={1} marginTop={1} flexWrap="wrap">
            {reverts.map(one => (
              <Button key={`revert-${one.id}`} label={`Revert ${one.id}`} plain onPress={() => (isDemo ? demoRevert($, one.id) : liveRevert($, one.id).then(result => result.text)).then(text => $.ui.toast(text))} />
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
