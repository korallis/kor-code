// Reads the Kor daemon's status for the cockpit: the loopback HTTP endpoint
// first, the snapshot files second. A hooks module imports only files inside
// its plugin, so the payload is checked here by hand rather than with the
// daemon's own types; anything missing or malformed is drawn UNAVAILABLE.
//
// Labels: a value the daemon answered over HTTP is LIVE while it is younger
// than the freshness window; older, or read from a snapshot file because the
// daemon did not answer, it is STALE with its age; absent, UNAVAILABLE.

import {
  ageText,
  unavailable,
  type Account,
  type Acceptance,
  type Agent,
  type CockpitData,
  type ContextSource,
  type Decision,
  type Event,
  type Execution,
  type Issue,
  type Override,
  type Part,
  type Project,
} from './model'

export const DEFAULT_STATUS_URL = 'http://127.0.0.1:8327/status'
/** Used when the payload names no poll interval of its own. */
const DEFAULT_FRESH_SECONDS = 60

export type LiveSource = { statusUrl: string | undefined; snapshotsDir: string }
export type Fetched = { payload: unknown; origin: string; isDaemonAnswer: boolean } | { payload: undefined; origin: string; why: string }

type Json = Record<string, unknown>
const object = (value: unknown): Json | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback)
const number = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
/** The first of `keys` the record has, so the reader accepts both spellings the daemon may settle on. */
const pick = (record: Json | undefined, ...keys: string[]): unknown => {
  for (const key of keys) if (record && record[key] !== undefined && record[key] !== null) return record[key]
  return undefined
}
const time = (value: unknown): string => {
  const raw = text(value)
  return /^\d{4}-\d\d-\d\dT(\d\d:\d\d:\d\d)/.exec(raw)?.[1] ?? raw
}

/** Where the cockpit looks: env overrides first, then the runtime paths `kor` itself uses. */
export function liveSource(env: { statusUrl?: string; stateDir?: string; xdgStateHome?: string; home?: string }): LiveSource {
  const statusUrl = env.statusUrl === 'off' ? undefined : (env.statusUrl || DEFAULT_STATUS_URL)
  const stateDir = env.stateDir || `${env.xdgStateHome || `${env.home ?? ''}/.local/state`}/kor`
  return { statusUrl, snapshotsDir: `${stateDir.replace(/\/$/, '')}/snapshots` }
}

export type Reader = {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; text: string }>
  read: (path: string) => Promise<string>
}

/** One status payload: the daemon over HTTP, else its last snapshot index on disk. */
export async function fetchStatus(source: LiveSource, reader: Reader): Promise<Fetched> {
  let why = 'daemon status not configured (KOR_STATUS_URL=off)'
  if (source.statusUrl) {
    try {
      const response = await reader.fetch(source.statusUrl)
      if (response.ok) return { payload: JSON.parse(response.text), origin: source.statusUrl, isDaemonAnswer: true }
      why = `daemon answered HTTP ${response.status}`
    } catch {
      why = `daemon unreachable at ${source.statusUrl}`
    }
  }
  const index = `${source.snapshotsDir}/index.json`
  try {
    return { payload: JSON.parse(await reader.read(index)), origin: index, isDaemonAnswer: false }
  } catch {
    return { payload: undefined, origin: 'none', why: `${why}; no snapshot at ${index}` }
  }
}

function executionsOf(payload: Json): Json[] {
  return list(pick(payload, 'executions', 'runs')).map(object).filter((one): one is Json => one !== undefined)
}

/** The execution the cockpit follows: one still running, else the most recently active; the daemon lists runs oldest first. */
function current(executions: Json[]): Json | undefined {
  const active = ['running', 'evaluating', 'verifying', 'repairing', 'waiting', 'ready', 'queued', 'shipping', 'review']
  const updated = (one: Json) => Math.max(Date.parse(text(pick(one, 'updatedAt', 'heartbeatAt', 'startedAt'))) || 0, ...list(pick(one, 'decisions')).map(decision => Date.parse(text(pick(object(decision), 'recordedAt'))) || 0))
  const sorted = executions.map((one, index) => ({ one, index })).sort((left, right) => updated(right.one) - updated(left.one) || right.index - left.index).map(entry => entry.one)
  return sorted.find(one => active.includes(text(pick(one, 'status', 'state')))) ?? sorted[0]
}

/** The lifecycle stage a run status stands for, until the daemon reports stages itself. */
const STAGE_OF: Record<string, string> = { queued: 'discover', ready: 'discover', evaluating: 'preflight', running: 'execute', waiting: 'supervise', verifying: 'verify', repairing: 'verify', shipping: 'synchronise', review: 'synchronise', complete: 'synchronise' }

function routeText(value: unknown): { route: string; source: string } {
  const route = object(value)
  if (!route) return { route: text(value, 'none'), source: 'jev' }
  const model = text(pick(route, 'model'), 'none')
  const effort = text(pick(route, 'reasoningLevel', 'effort'))
  return { route: effort ? `${model} · ${effort}` : model, source: text(pick(route, 'source', 'provenance'), 'jev') }
}

function decisionOf(value: unknown): Decision | undefined {
  const one = object(value)
  const decisionId = text(pick(one, 'decisionId', 'id'))
  if (!one || !decisionId) return undefined
  const response = object(pick(one, 'response')) ?? one
  const override = object(pick(one, 'override'))
  return {
    decisionId,
    kind: text(pick(response, 'kind', 'decisionKind'), text(pick(one, 'kind'))),
    question: text(pick(response, 'question')),
    choice: text(pick(response, 'choice')),
    candidates: list(pick(response, 'candidates')).map(item => text(item)),
    confidence: number(pick(response, 'confidence')),
    reasons: list(pick(response, 'reasons')).map(item => text(item)),
    evidenceRefs: list(pick(response, 'evidenceRefs')).map(item => text(item)),
    policyChecks: list(pick(response, 'policyChecks')).map(object).filter((item): item is Json => item !== undefined).map(item => ({ name: text(item.name), result: text(item.result) })),
    ...(override ? { source: `override ${text(pick(override, 'id'))}`.trim() } : pick(one, 'source', 'provenance') ? { source: text(pick(one, 'source', 'provenance')) } : response.escalated === true ? { source: 'escalated' } : {}),
  }
}

function accountOf(value: unknown): Account | undefined {
  const one = object(value)
  if (!one) return undefined
  const status = text(pick(one, 'status', 'state'), 'unknown')
  const remaining = pick(one, 'remainingQuota')
  const reset = text(pick(one, 'resetAt'))
  return {
    provider: text(pick(one, 'provider', 'type'), 'unknown'),
    // Identities stay opaque: the daemon sends a hash, and only its head is drawn.
    slot: text(pick(one, 'slot', 'id', 'hash'), '?').replace(/^account-/, '').slice(0, 10),
    state: status,
    route: text(pick(one, 'route'), status === 'available' ? 'eligible' : 'blocked'),
    lastEvent: text(pick(one, 'lastEvent'), [remaining !== undefined ? `quota ${text(remaining)}` : '', reset ? `resets ${time(reset)}` : ''].filter(Boolean).join(' · ') || 'no event'),
  }
}

/** Builds the cockpit's data from one status payload; `now` is the session clock in ms. */
export function fromStatus(fetched: Fetched, now: number): CockpitData {
  // The whole reason once, on the execution; every other part says it short.
  const empty = (why: string, short = 'daemon down: see Execution'): CockpitData => ({
    mode: 'live',
    origin: fetched.origin,
    execution: unavailable(undefined, why),
    issue: unavailable(undefined, short),
    project: unavailable(undefined, short),
    decisions: unavailable([], short),
    events: unavailable([], short),
    agents: unavailable([], short),
    acceptance: unavailable([], short),
    accounts: unavailable([], short),
    failovers: unavailable([], short),
    context: unavailable({ sources: [], dropped: [] }, short),
    linear: unavailable({ records: [], writes: [] }, short),
    overrides: unavailable([], short),
    queue: unavailable([], short),
    overridePath: 'unavailable: overrides need the daemon (kor serve)',
  })
  if (fetched.payload === undefined) return empty('why' in fetched ? fetched.why : 'no status')
  // HTTP answers an envelope { provenance, snapshot, reason }; the snapshot file is the bare snapshot.
  const envelope = object(fetched.payload)
  if (envelope && pick(envelope, 'provenance') === 'unavailable') return empty(`daemon reports: ${text(pick(envelope, 'reason'), 'no snapshot yet')}`, 'daemon has no snapshot: see Execution')
  const payload = object(pick(envelope, 'snapshot')) ?? envelope
  if (!payload) return empty(`malformed status from ${fetched.origin}`, 'malformed status: see Execution')
  const isDaemonAnswer = 'isDaemonAnswer' in fetched && fetched.isDaemonAnswer
  const daemon = object(pick(payload, 'daemon'))
  const freshSeconds = number(pick(payload, 'pollIntervalSeconds') ?? pick(daemon, 'pollIntervalSeconds', 'heartbeatSeconds'), DEFAULT_FRESH_SECONDS)
  const generatedAt = text(pick(payload, 'observedAt', 'generatedAt', 'updatedAt'))

  /** The label for a value observed at `observedAt` (the payload's own time when absent). */
  const part = <T>(value: T, observedAt?: string): Part<T> => {
    const at = Date.parse(observedAt || generatedAt)
    const seconds = Number.isFinite(at) ? Math.max(0, (now - at) / 1000) : Number.POSITIVE_INFINITY
    const age = Number.isFinite(seconds) ? ageText(seconds) : 'unknown'
    if (isDaemonAnswer && seconds <= freshSeconds) return { value, provenance: 'live' }
    return { value, provenance: 'stale', age, why: isDaemonAnswer ? `older than ${freshSeconds}s` : 'daemon did not answer; last snapshot' }
  }
  const missing = <T>(value: T, what: string): Part<T> => unavailable(value, `${what} not reported by the daemon`)

  const executions = executionsOf(payload)
  const exec = current(executions)
  const issueRecord = object(pick(exec, 'issue'))
  const issueId = text(pick(issueRecord, 'identifier', 'id'), text(pick(exec, 'issueKey', 'issueId')))
  const observedAt = text(pick(exec, 'observedAt', 'updatedAt'))
  const { route, source: nestedSource } = routeText(pick(exec, 'route'))
  const routeSource = text(pick(exec, 'routeSource'), nestedSource)
  const execution: Part<Execution | undefined> = exec
    ? part({
        id: text(pick(exec, 'executionId', 'id'), '?'),
        status: text(pick(exec, 'status', 'state'), 'unknown'),
        stage: text(pick(exec, 'stage'), STAGE_OF[text(pick(exec, 'status', 'state'))] ?? text(pick(exec, 'status', 'state'), 'unknown')),
        route,
        routeSource,
        worktree: text(pick(exec, 'worktree')),
        branch: text(pick(exec, 'branch')),
        session: text(pick(exec, 'sessionId', 'session')),
        pullRequest: text(pick(exec, 'pullRequestUrl', 'pullRequest')),
        attempts: number(pick(exec, 'attempts', 'attempt'), 1),
        updatedAt: time(text(pick(exec, 'heartbeatAt'), observedAt)),
        error: text(pick(exec, 'error', 'lastError')),
      }, observedAt)
    : part(undefined)

  const issue: Part<Issue | undefined> = exec && issueId
    ? part({
        id: issueId,
        title: text(pick(issueRecord, 'title'), text(pick(exec, 'issueTitle', 'title'), 'title not read from Linear yet')),
        url: text(pick(issueRecord, 'url'), text(pick(exec, 'issueUrl'))),
        priority: text(pick(issueRecord, 'priority', 'priorityLabel'), 'unknown'),
        labels: list(pick(issueRecord, 'labels')).map(label => text(pick(object(label), 'name') ?? label)),
        intent: text(pick(issueRecord, 'description', 'intent')).split('\n')[0] ?? '',
        state: text(pick(issueRecord, 'state', 'stateName'), text(pick(exec, 'issueState', 'linearState'))),
      }, observedAt)
    : exec ? missing(undefined, 'the issue') : part(undefined)

  // Decisions arrive per run, or (the daemon's contract) as one labelled list matched by the run's decisionIds.
  const allDecisions = object(pick(payload, 'decisions'))
  const runDecisionIds = list(pick(exec, 'decisionIds')).map(item => text(item))
  const decisionsRaw = pick(exec, 'decisions') ?? (allDecisions && exec ? list(pick(allDecisions, 'value')).filter(one => runDecisionIds.includes(text(pick(object(one), 'decisionId'))) || text(pick(object(one), 'executionId')) === text(pick(exec, 'executionId'))) : undefined)
  const decisionValues = list(decisionsRaw).map(decisionOf).filter((one): one is Decision => one !== undefined)
  const decisions = decisionValues.length || pick(exec, 'decisions') !== undefined ? part(decisionValues, observedAt) : exec ? unavailable([] as Decision[], 'no Jev decisions recorded for this execution yet') : part([] as Decision[])
  const eventValues: Event[] = list(pick(exec, 'events')).map(object).filter((one): one is Json => one !== undefined).map(one => ({
    at: time(pick(one, 'at', 'occurredAt', 'recordedAt')),
    stage: text(pick(one, 'stage')),
    text: text(pick(one, 'text', 'summary', 'kind', 'type')),
    ...(pick(one, 'detail') ? { detail: text(pick(one, 'detail')) } : {}),
    ...(pick(one, 'decisionId') ? { decisionId: text(pick(one, 'decisionId')) } : {}),
    ...(pick(one, 'agentId') ? { agentId: text(pick(one, 'agentId')) } : {}),
  }))
  // A daemon that records decisions but no event stream still gets a decision stream.
  const decisionTimes = new Map(list(decisionsRaw).map(object).map(one => [text(pick(one, 'decisionId')), time(pick(one, 'recordedAt'))]))
  const streamed = eventValues.length || !decisionValues.length ? eventValues : decisionValues.map(one => ({ at: decisionTimes.get(one.decisionId) ?? '', stage: 'preflight', text: `${one.kind || 'decision'}: ${one.choice}`, detail: `confidence ${one.confidence.toFixed(2)}${one.source === 'escalated' ? ' · escalated' : ''}`, decisionId: one.decisionId }))
  const events = pick(exec, 'events') !== undefined || decisionValues.length ? part(streamed, observedAt) : exec ? unavailable([] as Event[], 'no Jev decisions recorded for this execution yet') : part([] as Event[])

  const agentList = list(pick(exec, 'agents')).map(object).filter((one): one is Json => one !== undefined).map(one => ({ id: text(pick(one, 'id', 'name'), '?'), role: text(pick(one, 'role', 'description')), status: text(pick(one, 'status'), 'unknown') }))
  const sessionAgent: Agent[] = exec && !agentList.length ? [{ id: 'session', role: `Claude Code session${execution.value?.attempts ? `, attempt ${execution.value.attempts}` : ''}`, status: ['running', 'repairing'].includes(execution.value?.status ?? '') ? 'working' : ['complete', 'review'].includes(execution.value?.status ?? '') ? 'done' : 'waiting' }] : []
  const agents = exec ? part([...agentList, ...sessionAgent], observedAt) : part([] as Agent[])

  const acceptanceRaw = pick(exec, 'acceptance', 'findings', 'criteria')
  const acceptanceValues: Acceptance[] = list(acceptanceRaw).map(object).filter((one): one is Json => one !== undefined).map(one => ({
    id: text(pick(one, 'id', 'conditionId'), '?'),
    text: text(pick(one, 'text', 'description')),
    status: text(pick(one, 'status'), 'pending'),
    evidence: text(pick(one, 'evidence', 'note'), list(pick(one, 'evidenceIds')).map(item => text(item)).join(', ') || 'none yet'),
  }))
  const acceptance = acceptanceRaw !== undefined ? part(acceptanceValues, observedAt) : exec ? missing([] as Acceptance[], 'acceptance findings') : part([] as Acceptance[])

  // The account pool is a labelled value: its own provenance (a failed gateway read is stale or unavailable) bounds ours.
  const gateway = object(pick(payload, 'accounts', 'gateway'))
  const gatewayAt = text(pick(gateway, 'observedAt'))
  const gatewayProvenance = text(pick(gateway, 'provenance'))
  const accountsRaw = pick(gateway, 'value', 'accounts', 'slots')
  const accountValues = list(accountsRaw).map(accountOf).filter((one): one is Account => one !== undefined)
  const accountReason = text(pick(gateway, 'reason', 'error'))
  const accounts: Part<Account[]> = accountsRaw === undefined
    ? missing([] as Account[], 'gateway account facts')
    : gatewayProvenance === 'unavailable' || (accountReason && accountValues.length === 0)
      ? unavailable([] as Account[], accountReason || 'the daemon could not read the gateway')
      : gatewayProvenance === 'stale' || accountReason
        ? { value: accountValues, provenance: 'stale', age: Number.isFinite(Date.parse(gatewayAt)) ? ageText(Math.max(0, (now - Date.parse(gatewayAt)) / 1000)) : 'unknown', why: accountReason || 'gateway read is stale' }
        : part(accountValues, gatewayAt)
  const failoverRaw = pick(exec, 'failovers')
  const failovers = failoverRaw !== undefined ? part(list(failoverRaw).map(item => text(pick(object(item), 'text', 'summary') ?? item)), observedAt) : missing([] as string[], 'failovers')

  const manifest = object(pick(exec, 'context', 'contextManifest'))
  const context = manifest
    ? part({
        sources: list(pick(manifest, 'sources')).map(object).filter((one): one is Json => one !== undefined).map((one): ContextSource => ({ source: text(pick(one, 'path', 'source', 'id')), purpose: text(pick(one, 'purpose')), relevance: number(pick(one, 'relevance')) })),
        dropped: list(pick(manifest, 'droppedSources', 'dropped')).map(object).filter((one): one is Json => one !== undefined).map(one => ({ source: text(pick(one, 'path', 'source', 'id')), reason: text(pick(one, 'reason', 'purpose'), 'dropped') })),
      }, observedAt)
    : exec ? missing({ sources: [], dropped: [] }, 'the context manifest') : part({ sources: [], dropped: [] })

  const writes = list(pick(exec, 'linearWrites', 'linear')).map(object).filter((one): one is Json => one !== undefined).map(one => ({ at: time(pick(one, 'at', 'recordedAt')), text: text(pick(one, 'text', 'summary', 'kind')) }))
  const linear = exec
    ? part({
        records: [
          { name: 'Issue', value: issue.value?.url || issueId || 'unknown' },
          { name: 'Branch', value: execution.value?.branch || 'none' },
          { name: 'Pull request', value: execution.value?.pullRequest || 'not opened yet' },
        ],
        writes,
      }, observedAt)
    : part({ records: [], writes: [] })

  const ownOverrides = pick(exec, 'overrides')
  const overrideValues: Override[] = list(ownOverrides ?? pick(payload, 'overrides')).map(object).filter((one): one is Json => one !== undefined)
    .filter(one => ownOverrides !== undefined || text(pick(one, 'executionId')) === execution.value?.id).map(one => ({
    id: text(pick(one, 'id', 'overrideId'), '?'),
    decisionId: text(pick(one, 'target', 'decisionId')),
    action: text(pick(one, 'action'), 'override'),
    choice: text(pick(one, 'choice', 'model')),
    at: time(pick(one, 'at', 'recordedAt', 'createdAt')),
    status: text(pick(one, 'status'), 'applied'),
    detail: [text(pick(one, 'reason', 'detail')), pick(one, 'linearComment') && pick(one, 'linearComment') !== 'skipped' ? `Linear comment ${text(pick(one, 'linearComment'))}` : ''].filter(Boolean).join(' · '),
  }))
  const overrides = pick(payload, 'overrides') !== undefined || pick(exec, 'overrides') !== undefined ? part(overrideValues) : missing([] as Override[], 'overrides')

  const repoKey = text(pick(exec, 'repository', 'repo'))
  const project: Part<Project | undefined> = exec
    ? part({ name: text(pick(object(pick(exec, 'project')), 'name'), repoKey), team: issueId.split('-')[0] ?? '', repository: repoKey, milestone: '', url: '', issues: [], documents: [] }, observedAt)
    : part(undefined)
  const queue = part(
    executions
      .map(one => ({ id: text(pick(one, 'executionId', 'id')), issueId: text(pick(object(pick(one, 'issue')), 'identifier', 'id'), text(pick(one, 'issueId'))), status: text(pick(one, 'status', 'state')), route: routeText(pick(one, 'route')).route, updatedAt: time(pick(one, 'updatedAt', 'startedAt')) }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  )

  return {
    mode: 'live',
    origin: fetched.origin,
    execution,
    issue,
    project,
    decisions,
    events,
    agents,
    acceptance,
    accounts,
    failovers,
    context,
    linear,
    overrides,
    queue,
    overridePath: isDaemonAnswer ? 'sent to the daemon: policy-checked, audited, commented on Linear' : 'unavailable: the daemon did not answer, so overrides cannot be sent',
  }
}
