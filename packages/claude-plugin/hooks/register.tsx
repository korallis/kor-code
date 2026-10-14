// The Kor Code cockpit mod: a pinned status line, the /kor views in a pane,
// and /kor-status as the sandbox's deterministic load proof. It only draws;
// it writes no settings, files or remote records.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { KorOverride, KorProvenance, KorView } from '../types'
import { DECISIONS, EVENTS } from './fixture'
import { buildView, columnWidths, effectiveChoice, LABEL, padCells, parseView, renderText, statusLine, tag, VIEWS, type LiveFacts, type Tone } from './views'

const PANE = 'kor-cockpit'
const view = atom({ plugin: 'kor-code-cockpit', key: 'view' } as const, { id: 'cockpit' })
const cursor = atom({ plugin: 'kor-code-cockpit', key: 'cursor' } as const, null)
const overrides = atom({ plugin: 'kor-code-cockpit', key: 'overrides' } as const, [])

const TAG_COLOR: Record<KorProvenance, string> = { live: 'success', stale: 'error', fixture: 'warning', unavailable: 'inactive' }
const TONE_COLOR: Record<Tone, string> = { ok: 'success', warn: 'warning', bad: 'error', dim: 'inactive', accent: 'suggestion' }
const ACTIONS = [
  { action: 'apply', label: 'Apply', hotkey: 'a' },
  { action: 'override', label: 'Override', hotkey: 'o' },
  { action: 'evidence', label: 'Gather evidence', hotkey: 'e' },
  { action: 'reevaluate', label: 'Re-evaluate', hotkey: 'r' },
] as const
const USAGE = 'Usage: /kor [cockpit|issue|project|decisions|decision <id>|agents|agent <id>|accounts|context|linear|overrides|replay|apply|override|evidence|reevaluate <decision> [choice]|revert <override>]'

let replay: Timer | undefined

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

async function liveFacts($: EngineInterface): Promise<LiveFacts> {
  return { claudeCode: (await $.session.version()).version }
}

async function refreshStatus($: EngineInterface): Promise<void> {
  $.ui.status(statusLine(await read($, cursor), await read($, overrides), await liveFacts($)))
}

async function show($: EngineInterface, next: KorView): Promise<void> {
  await update($, view, () => next)
}

async function act($: EngineInterface, action: KorOverride['action'], decisionId: string, wanted?: string): Promise<string> {
  const decision = DECISIONS.find(one => one.decisionId === decisionId)
  if (!decision) return `No decision ${decisionId} in the fixture.`
  const list = await read($, overrides)
  const current = effectiveChoice(decision, list).choice
  const choice = action === 'override' ? (wanted ?? decision.candidates[(decision.candidates.indexOf(current) + 1) % decision.candidates.length] ?? current) : current
  if (action === 'override' && !decision.candidates.includes(choice)) return `${choice} is not a candidate of ${decisionId}: ${decision.candidates.join(' | ')}`
  const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
  const record: KorOverride = { id: `ovr_${list.length + 1}`, decisionId, action, choice, at, isReverted: false }
  await update($, overrides, all => [...all, record])
  await refreshStatus($)
  return `${record.id}: ${action} ${decisionId} → ${choice} [${LABEL.fixture}; session-local, not sent to Jev, the gateway or Linear]`
}

async function revert($: EngineInterface, id: string): Promise<string> {
  const list = await read($, overrides)
  const record = list.find(one => one.id === id)
  if (!record) return `No override ${id}.`
  if (record.isReverted) return `${id} is already reverted.`
  await update($, overrides, all => all.map(one => (one.id === id ? { ...one, isReverted: true } : one)))
  await refreshStatus($)
  return `${id} reverted; ${record.decisionId} is back to ${effectiveChoice(DECISIONS.find(one => one.decisionId === record.decisionId)!, await read($, overrides)).choice} [${LABEL.fixture}]`
}

async function startReplay($: EngineInterface): Promise<void> {
  replay?.cancel()
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
  const frames = EVENTS.map((event, index) => `${String(index + 1).padStart(2)}. ${event.at} ${event.stage.padEnd(11)} ${event.text}\n    status line: ${statusLine(index + 1, list, live)}`)
  return [`Replay of ${EVENTS.length} fixture events [${LABEL.fixture}]`, ...frames, '', renderText(buildView({ id: 'cockpit' }, null, list, live))].join('\n')
}

export const register: Register = on => {
  on('classic.PreToolUse', ($, e, next) => {
    const reason = policyDecision(e.tool, e)
    return reason ? { deny: reason } : next(e)
  }).catch(() => ({ deny: 'Kor policy hook failed closed.' }))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kor', description: 'Kor Code cockpit views (fixture data)', argumentHint: '[view] [id]' })
    await $.command.register({ name: 'kor-status', description: 'Show the session-local Kor Code cockpit status' })
    await refreshStatus($)
    return next(e)
  })

  on('command.run', { command: 'kor-status' }, async $ => {
    const live = await liveFacts($)
    const line = statusLine(await read($, cursor), await read($, overrides), live)
    return { text: `Kor Code cockpit plugin loaded (session-local; no configuration changes).\n${line}`, exitCode: 0 }
  })

  on('command.run', { command: 'kor' }, async ($, e) => {
    const isHeadless = e.origin.kind === 'sdk'
    const [verb = '', first, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    if (verb === 'replay') {
      if (isHeadless) return { text: await replayText($) }
      await show($, { id: 'cockpit' })
      await $.ui.open({ id: PANE, title: 'Kor cockpit', focus: true, rows: 48 })
      await startReplay($)
      return { text: `Replaying ${EVENTS.length} fixture events in the Kor cockpit pane and status line [${LABEL.fixture}].` }
    }
    if (verb === 'revert') return first ? { text: await revert($, first) } : { text: USAGE, exitCode: 2 }
    const action = ACTIONS.find(one => one.action === verb)?.action
    if (action) return first ? { text: await act($, action, first, rest.length ? rest.join(' ') : undefined) } : { text: USAGE, exitCode: 2 }
    const target = parseView(e.args)
    if (!target) return { text: USAGE, exitCode: 2 }
    await show($, target)
    if (isHeadless) return { text: renderText(buildView(target, await read($, cursor), await read($, overrides), await liveFacts($))) }
    await $.ui.open({ id: PANE, title: 'Kor cockpit', focus: true, rows: 48 })
    return { text: `Kor cockpit: ${target.id}${target.target ? ` ${target.target}` : ''} [${LABEL.fixture} data; ${LABEL.live} values come from this session]` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, view)
    const shown = await read($, cursor)
    const list = await read($, overrides)
    const model = buildView(current, shown, list, await liveFacts($))
    const columns = e.props.bodyColumns

    const nav = (
      <Box flexWrap="wrap" columnGap={1}>
        {VIEWS.map(one => (
          <Button key={`nav-${one.id}`} label={one.label} hotkey={one.hotkey} plain variant={one.id === current.id ? 'primary' : 'secondary'} onPress={() => show($, { id: one.id })} />
        ))}
        <Button key="replay" label={shown === null ? 'Replay' : `Replaying ${shown}/${EVENTS.length}`} hotkey="p" plain onPress={() => startReplay($)} />
        <Button key="close" label="Close" hotkey="q" plain role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )

    const sections = model.sections.map((section, sectionIndex) => {
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

    const decisionId = current.id === 'decision' ? current.target : undefined
    const drill = decisionId && DECISIONS.some(one => one.decisionId === decisionId) ? (
      <Box columnGap={1} marginTop={1} flexWrap="wrap">
        {ACTIONS.map(one => (
          <Button key={`act-${one.action}`} label={one.label} hotkey={one.hotkey} plain onPress={() => act($, one.action, decisionId).then(text => $.ui.toast(text))} />
        ))}
        <Button key="back" label="Back" hotkey="b" plain onPress={() => show($, { id: 'decisions' })} />
      </Box>
    ) : null

    const reverts = current.id === 'overrides' || current.id === 'decision'
      ? list.filter(one => !one.isReverted && (current.id === 'overrides' || one.decisionId === current.target))
      : []

    return (
      <Box flexDirection="column" width={columns}>
        <Box columnGap={1}>
          <Text bold>{model.title}</Text>
          <Text color="warning" inverse> {LABEL.fixture} DATA </Text>
          {shown !== null && <Text color="suggestion">replay {shown}/{EVENTS.length}</Text>}
        </Box>
        <Text dimColor wrap="truncate-end">
          [{LABEL.fixture}] fixture · [{LABEL.live}] this session · [{LABEL.unavailable}] not wired yet
        </Text>
        {nav}
        {sections}
        {drill}
        {reverts.length > 0 && (
          <Box columnGap={1} marginTop={1} flexWrap="wrap">
            {reverts.map(one => (
              <Button key={`revert-${one.id}`} label={`Revert ${one.id}`} plain onPress={() => revert($, one.id).then(text => $.ui.toast(text))} />
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
