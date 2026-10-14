// One fixture execution, from discovery to Linear synchronisation, shown by
// `/kor demo`. Every value here is drawn with the FIXTURE label; `/kor` itself
// draws the daemon's live status (live.ts).

import type { KorOverride } from '../types'
import { type CockpitData, type Override, type Part, type Stage } from './model'

export type ExecutionStatus = 'queued' | 'evaluating' | 'running' | 'waiting' | 'verifying' | 'repairing' | 'complete' | 'failed' | 'escalated'
export type AgentStatus = 'waiting' | 'working' | 'done'
export type AcceptanceStatus = 'pending' | 'pass' | 'fail' | 'unresolved'
export type AccountState = 'available' | 'quota-limited' | 'unknown'
export type AccountRoute = 'preferred' | 'standby' | 'eligible' | 'blocked'

/** The shape of core's DecisionBundle; a hooks module imports only files inside its plugin. */
export type Decision = {
  decisionId: string
  kind: string
  executionId: string
  question: string
  choice: string
  candidates: string[]
  confidence: number
  reasons: string[]
  evidenceRefs: string[]
  policyChecks: Array<{ name: string; result: 'pass' | 'fail' | 'unresolved' }>
}

export type Agent = { id: string; role: string }
export type Account = { provider: string; slot: string; state: AccountState; route: AccountRoute; lastEvent: string }
export type Acceptance = { id: string; text: string }

/** One controller event; its optional fields change the execution as it is replayed. */
export type ExecutionEvent = {
  at: string
  stage: Stage
  text: string
  detail?: string
  decisionId?: string
  status?: ExecutionStatus
  agent?: { id: string; status: AgentStatus }
  acceptance?: { id: string; status: AcceptanceStatus; evidence: string }
  account?: { slot: string; state: AccountState; route: AccountRoute; lastEvent: string }
  linear?: string
  failover?: string
}

export const PROJECT = {
  id: 'project_fixture_matilda',
  name: 'Matilda v2',
  team: 'ENG',
  repository: 'github.com/example/matilda',
  milestone: 'Performance pass',
  url: 'https://linear.app/example/project/matilda-v2',
  issues: [
    { id: 'FIX-120', title: 'Profile cold start', state: 'Done', note: 'completed by exec_fixture_00' },
    { id: 'FIX-123', title: 'Investigate performance regression', state: 'In Progress', note: 'exec_fixture_01' },
    { id: 'FIX-124', title: 'Warm the search cache', state: 'Todo', note: 'blocked by FIX-123' },
    { id: 'FIX-125', title: 'Tidy chart colours', state: 'Backlog', note: 'skipped: no acceptance conditions' },
  ],
  documents: [
    { title: 'Performance budget', purpose: 'p95 targets per screen' },
    { title: 'Matilda v2 brief', purpose: 'product intent and constraints' },
  ],
}

export const ISSUE = {
  id: 'FIX-123',
  title: 'Investigate performance regression',
  url: 'https://linear.app/example/issue/FIX-123',
  priority: 'High',
  labels: ['performance', 'frontend'],
  intent: 'The dashboard renders slower since the chart refactor; find the cause and restore the budget.',
  acceptance: [
    { id: 'regression-covered', text: 'A test reproduces the slow render path' },
    { id: 'p95-restored', text: 'p95 dashboard render is under 120 ms' },
    { id: 'no-new-deps', text: 'No new runtime dependency' },
  ] satisfies Acceptance[],
}

export const EXECUTION = {
  id: 'exec_fixture_01',
  repository: PROJECT.repository,
  worktree: '/worktrees/exec_fixture_01',
  branch: 'kor/fix-123-performance',
  session: 'agent_session_fixture_01',
  pullRequest: 'https://github.com/example/matilda/pull/42',
}

export const AGENTS: Agent[] = [
  { id: 'jev', role: 'orchestrating' },
  { id: 'investigator', role: 'repository investigation' },
  { id: 'frontend', role: 'render-path change' },
  { id: 'reviewer', role: 'review and acceptance' },
]

export const ACCOUNTS: Account[] = [
  { provider: 'Claude', slot: 'claude-01', state: 'available', route: 'eligible', lastEvent: 'no active session' },
  { provider: 'Claude', slot: 'claude-02', state: 'available', route: 'standby', lastEvent: 'waiting' },
  { provider: 'Claude', slot: 'claude-03', state: 'available', route: 'eligible', lastEvent: 'no active session' },
  { provider: 'ChatGPT', slot: 'gpt-01', state: 'available', route: 'eligible', lastEvent: 'no active session' },
  { provider: 'ChatGPT', slot: 'gpt-02', state: 'available', route: 'eligible', lastEvent: 'no active session' },
  { provider: 'Grok', slot: 'grok-01', state: 'available', route: 'eligible', lastEvent: 'no active session' },
  { provider: 'Devin', slot: 'devin-01', state: 'unknown', route: 'blocked', lastEvent: 'compatibility test required' },
]

export const CONTEXT = [
  { source: 'CLAUDE.md', purpose: 'repository rules', relevance: 0.94 },
  { source: 'docs/perf.md', purpose: 'performance budget and bench command', relevance: 0.91 },
  { source: 'src/render/cache.ts', purpose: 'existing memo cache to reuse', relevance: 0.88 },
  { source: 'src/charts/Dashboard.tsx', purpose: 'render path changed by the refactor', relevance: 0.86 },
  { source: 'dec_fx_route', purpose: 'prior decision: keep the warm cache', relevance: 0.72 },
  { source: 'FIX-123 acceptance', purpose: 'three conditions to evidence', relevance: 1 },
]

export const CONTEXT_DROPPED = [
  { source: 'build log 10:31', reason: 'stale tool output' },
  { source: '.env.example', reason: 'redacted: credential-shaped values' },
]

export const DECISIONS: Decision[] = [
  {
    decisionId: 'dec_fx_select',
    kind: 'select',
    executionId: EXECUTION.id,
    question: 'Which ready issue should run next?',
    choice: 'FIX-123',
    candidates: ['FIX-123', 'FIX-124', 'FIX-125'],
    confidence: 0.93,
    reasons: ['FIX-123 is high priority and has acceptance conditions.', 'FIX-124 is blocked by FIX-123.', 'FIX-125 has no acceptance conditions.'],
    evidenceRefs: ['snapshot snap_fx_07'],
    policyChecks: [{ name: 'acceptance conditions present', result: 'pass' }, { name: 'dependencies clear', result: 'pass' }],
  },
  {
    decisionId: 'dec_fx_classify',
    kind: 'classify',
    executionId: EXECUTION.id,
    question: 'What kind of task is this?',
    choice: 'performance investigation',
    candidates: ['performance investigation', 'feature', 'refactor'],
    confidence: 0.9,
    reasons: ['The intent names a regression against a budget.', 'Acceptance asks for a measured p95.'],
    evidenceRefs: ['FIX-123 description', 'docs/perf.md'],
    policyChecks: [{ name: 'risk class', result: 'pass' }],
  },
  {
    decisionId: 'dec_fx_route',
    kind: 'route',
    executionId: EXECUTION.id,
    question: 'Which route fits this performance investigation?',
    choice: 'Claude Sonnet · medium effort',
    candidates: ['Claude Sonnet · medium effort', 'Claude Opus · high effort', 'GPT · medium effort'],
    confidence: 0.86,
    reasons: ['Repository context is large and the cache is warm.', 'The task needs code changes and test execution.', 'The evidence does not justify a stronger route.'],
    evidenceRefs: ['gateway catalogue (fixture)', 'cache locality: claude-01'],
    policyChecks: [{ name: 'route in catalogue', result: 'pass' }, { name: 'tool compatibility', result: 'pass' }],
  },
  {
    decisionId: 'dec_fx_context',
    kind: 'context',
    executionId: EXECUTION.id,
    question: 'Which context sources does the session need?',
    choice: '6 sources, 2 dropped',
    candidates: ['6 sources, 2 dropped', 'whole repository index'],
    confidence: 0.81,
    reasons: ['Repository rules and the perf budget are always relevant.', 'An existing memo cache can be reused.', 'Stale build output would mislead the agent.'],
    evidenceRefs: ['context manifest ctx_fx_01'],
    policyChecks: [{ name: 'redaction applied', result: 'pass' }],
  },
  {
    decisionId: 'dec_fx_agents',
    kind: 'agent',
    executionId: EXECUTION.id,
    question: 'Does this need a specialist agent?',
    choice: 'add frontend agent',
    candidates: ['add frontend agent', 'investigator alone'],
    confidence: 0.77,
    reasons: ['The cause is in the chart render path.', 'The investigator found a reusable cache.'],
    evidenceRefs: ['investigator finding f_fx_02'],
    policyChecks: [{ name: 'concurrency limit', result: 'pass' }],
  },
  {
    decisionId: 'dec_fx_verify',
    kind: 'verify',
    executionId: EXECUTION.id,
    question: 'How deep should verification go?',
    choice: 'tests + bench + review',
    candidates: ['tests + bench + review', 'tests only'],
    confidence: 0.88,
    reasons: ['Acceptance asks for a measured p95.', 'Render-path changes are review-worthy.'],
    evidenceRefs: ['FIX-123 acceptance', 'risk policy (fixture)'],
    policyChecks: [{ name: 'review required by risk', result: 'pass' }],
  },
]

export const EVENTS: ExecutionEvent[] = [
  { at: '10:40', stage: 'discover', text: 'Snapshot snap_fx_07 read', detail: '4 issues, 1 ready', status: 'queued' },
  { at: '10:41', stage: 'discover', text: 'FIX-123 selected', detail: 'FIX-124 blocked, FIX-125 skipped', decisionId: 'dec_fx_select' },
  { at: '10:42', stage: 'preflight', text: 'Task classified', detail: 'performance investigation', decisionId: 'dec_fx_classify', status: 'evaluating', agent: { id: 'jev', status: 'working' } },
  { at: '10:43', stage: 'preflight', text: 'Sonnet / medium selected', detail: 'cache retained', decisionId: 'dec_fx_route', account: { slot: 'claude-01', state: 'available', route: 'preferred', lastEvent: 'session affinity retained' } },
  { at: '10:44', stage: 'context', text: 'Repository rules selected', detail: '6 sources, 2 dropped', decisionId: 'dec_fx_context' },
  { at: '10:44', stage: 'context', text: 'Existing implementation found', detail: 'src/render/cache.ts' },
  { at: '10:45', stage: 'execute', text: 'Investigator started', detail: 'worktree /worktrees/exec_fixture_01', status: 'running', agent: { id: 'investigator', status: 'working' }, linear: 'Agent session started' },
  { at: '10:46', stage: 'execute', text: 'Frontend agent started', detail: 'specialist for the render path', decisionId: 'dec_fx_agents', agent: { id: 'frontend', status: 'working' } },
  { at: '10:47', stage: 'supervise', text: 'Failover claude-01 → claude-02', detail: 'quota response before the stream started', account: { slot: 'claude-01', state: 'quota-limited', route: 'blocked', lastEvent: 'quota response' }, failover: 'FIX-123 · claude-01 → claude-02 · reason: quota response · replay: not needed, no output had streamed' },
  { at: '10:47', stage: 'supervise', text: 'Session moved to claude-02', detail: 'affinity rebound by policy', account: { slot: 'claude-02', state: 'available', route: 'preferred', lastEvent: 'session affinity rebound' } },
  { at: '10:49', stage: 'supervise', text: 'Change set ready', detail: '3 files changed', agent: { id: 'investigator', status: 'done' } },
  { at: '10:50', stage: 'verify', text: 'Tests running', detail: 'tests + bench + review', decisionId: 'dec_fx_verify', status: 'verifying', agent: { id: 'reviewer', status: 'working' } },
  { at: '10:52', stage: 'verify', text: 'regression-covered passed', detail: 'perf.render.spec reproduces the slow path', acceptance: { id: 'regression-covered', status: 'pass', evidence: 'test perf.render.spec' } },
  { at: '10:53', stage: 'verify', text: 'p95-restored passed', detail: 'bench p95 104 ms', acceptance: { id: 'p95-restored', status: 'pass', evidence: 'bench p95 104 ms' }, agent: { id: 'frontend', status: 'done' } },
  { at: '10:53', stage: 'verify', text: 'no-new-deps passed', detail: 'lockfile unchanged', acceptance: { id: 'no-new-deps', status: 'pass', evidence: 'git diff pnpm-lock.yaml empty' } },
  { at: '10:54', stage: 'verify', text: 'Review: no blocking findings', detail: 'reviewer approved', agent: { id: 'reviewer', status: 'done' } },
  { at: '10:55', stage: 'synchronise', text: 'Pull request opened', detail: EXECUTION.pullRequest, linear: 'PR link attached' },
  { at: '10:56', stage: 'synchronise', text: 'Linear updated', detail: 'evidence written, state → In Review', status: 'complete', agent: { id: 'jev', status: 'done' }, linear: 'Evidence and outcome written' },
]

/** The choice in force for a demo decision: the latest unreverted session override, else Jev's. */
export function demoChoice(decision: Decision, overrides: KorOverride[]): { choice: string; override?: KorOverride } {
  const override = overrides.findLast(one => one.decisionId === decision.decisionId && !one.isReverted && one.action === 'override')
  return override ? { choice: override.choice, override } : { choice: decision.choice }
}

const fixture = <T>(value: T): Part<T> => ({ value, provenance: 'fixture' })

/** The fixture execution as it stood after the first `cursor` events (all of them when null). */
export function demoData(cursor: number | null, overrides: KorOverride[]): CockpitData {
  const shown = EVENTS.slice(0, cursor ?? EVENTS.length)
  const agents = new Map(AGENTS.map(agent => [agent.id, { ...agent, status: 'waiting' }]))
  const acceptance = new Map(ISSUE.acceptance.map(item => [item.id, { ...item, status: 'pending', evidence: 'none yet' }]))
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
  const route = DECISIONS.find(decision => decision.decisionId === 'dec_fx_route')
  const routeChoice = route ? demoChoice(route, overrides) : undefined
  const stage: Stage = shown.at(-1)?.stage ?? 'discover'
  const isComplete = shown.length === EVENTS.length
  const decisions = DECISIONS.map(decision => {
    const { choice, override } = demoChoice(decision, overrides)
    return override ? { ...decision, choice, source: `override ${override.id}; Jev chose ${decision.choice}` } : decision
  })
  const records: Override[] = overrides.map(one => ({
    id: one.id,
    decisionId: one.decisionId,
    action: one.action,
    choice: one.choice,
    at: one.at,
    status: one.isReverted ? 'reverted' : 'active',
    detail: 'session-local demo record; never sent to the daemon, Jev, the gateway or Linear',
  }))
  return {
    mode: 'demo',
    origin: 'hooks/fixture.ts',
    execution: fixture({
      id: EXECUTION.id,
      status,
      stage,
      route: routeChoice?.choice ?? 'none',
      routeSource: routeChoice?.override ? `override ${routeChoice.override.id}` : 'jev',
      worktree: EXECUTION.worktree,
      branch: EXECUTION.branch,
      session: EXECUTION.session,
      pullRequest: linear.some(item => item.text === 'PR link attached') ? EXECUTION.pullRequest : '',
      attempts: 1,
      updatedAt: shown.at(-1)?.at ?? '',
      error: '',
    }),
    issue: fixture({ id: ISSUE.id, title: ISSUE.title, url: ISSUE.url, priority: ISSUE.priority, labels: ISSUE.labels, intent: ISSUE.intent, state: isComplete ? 'In Review' : 'In Progress' }),
    project: fixture({ name: PROJECT.name, team: PROJECT.team, repository: PROJECT.repository, milestone: PROJECT.milestone, url: PROJECT.url, issues: PROJECT.issues, documents: PROJECT.documents }),
    decisions: fixture(decisions),
    events: fixture(shown.map(event => ({ at: event.at, stage: event.stage, text: event.text, ...(event.detail ? { detail: event.detail } : {}), ...(event.decisionId ? { decisionId: event.decisionId } : {}), ...(event.agent ? { agentId: event.agent.id } : {}) }))),
    agents: fixture([...agents.values()]),
    acceptance: fixture([...acceptance.values()]),
    accounts: fixture([...accounts.values()]),
    failovers: fixture(failovers),
    context: fixture({ sources: CONTEXT, dropped: CONTEXT_DROPPED }),
    linear: fixture({
      records: [
        { name: 'Issue', value: ISSUE.url },
        { name: 'Project', value: PROJECT.url },
        { name: 'Agent session', value: EXECUTION.session },
        { name: 'Pull request', value: linear.some(item => item.text === 'PR link attached') ? EXECUTION.pullRequest : 'not opened yet' },
      ],
      writes: linear,
    }),
    overrides: fixture(records),
    queue: fixture(PROJECT.issues.map(issue => ({ id: issue.note.startsWith('exec_') ? issue.note : '', issueId: issue.id, status: issue.state, route: '', updatedAt: '' }))),
    replay: { shown: shown.length, total: EVENTS.length, isComplete },
    overridePath: 'session-local (demo): never sent to the daemon, Jev, the gateway or Linear',
  }
}
