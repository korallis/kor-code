// The one shape every cockpit view draws from. The demo fills it from the
// fixture; the live reader fills it from the daemon's status (HTTP first, the
// snapshot files second) and labels each part LIVE, STALE or UNAVAILABLE.

import type { KorProvenance, KorView } from '../types'

export type Stage = 'discover' | 'preflight' | 'context' | 'execute' | 'supervise' | 'verify' | 'synchronise'
export const STAGES: Stage[] = ['discover', 'preflight', 'context', 'execute', 'supervise', 'verify', 'synchronise']

export type PolicyCheck = { name: string; result: string }
export type Decision = {
  decisionId: string
  kind: string
  question: string
  choice: string
  candidates: string[]
  confidence: number
  reasons: string[]
  evidenceRefs: string[]
  policyChecks: PolicyCheck[]
  /** `fallback` when Jev was unreachable and the default route stood in. */
  source?: string
}
export type Event = { at: string; stage: string; text: string; detail?: string; decisionId?: string; agentId?: string }
export type Agent = { id: string; role: string; status: string }
export type Acceptance = { id: string; text: string; status: string; evidence: string }
export type Account = { provider: string; slot: string; state: string; route: string; lastEvent: string }
export type ContextSource = { source: string; purpose: string; relevance: number }
export type LinearWrite = { at: string; text: string }
/** An override as the cockpit shows it: a daemon record when live, a session record in the demo. */
export type Override = { id: string; decisionId: string; action: string; choice: string; at: string; status: string; detail: string }

export type Issue = { id: string; title: string; url: string; priority: string; labels: string[]; intent: string; state: string }
export type Project = { name: string; team: string; repository: string; milestone: string; url: string; issues: Array<{ id: string; title: string; state: string; note: string }>; documents: Array<{ title: string; purpose: string }> }
export type Execution = { id: string; status: string; stage: string; route: string; routeSource: string; worktree: string; branch: string; session: string; pullRequest: string; attempts: number; updatedAt: string; error: string }

/** A part of the cockpit with the provenance it is drawn with; `age` says how old a stale value is. */
export type Part<T> = { value: T; provenance: KorProvenance; age?: string; why?: string }

export type CockpitData = {
  mode: 'demo' | 'live'
  /** Where the live data came from, for the legend: `http://…/status`, a snapshot file, or nothing. */
  origin: string
  execution: Part<Execution | undefined>
  issue: Part<Issue | undefined>
  project: Part<Project | undefined>
  decisions: Part<Decision[]>
  events: Part<Event[]>
  agents: Part<Agent[]>
  acceptance: Part<Acceptance[]>
  accounts: Part<Account[]>
  failovers: Part<string[]>
  context: Part<{ sources: ContextSource[]; dropped: Array<{ source: string; reason: string }> }>
  linear: Part<{ records: Array<{ name: string; value: string }>; writes: LinearWrite[] }>
  overrides: Part<Override[]>
  /** Other executions the daemon knows, newest first, for the project view. */
  queue: Part<Array<{ id: string; issueId: string; status: string; route: string; updatedAt: string }>>
  /** Demo replay progress: events shown and the total; absent when live. */
  replay?: { shown: number; total: number; isComplete: boolean }
  /** What the cockpit can do with an override in this mode. */
  overridePath: string
}

export function unavailable<T>(value: T, why: string): Part<T> {
  return { value, provenance: 'unavailable', why }
}

/** Seconds as the short age a STALE label carries: 42s, 7m, 3h, 2d. */
export function ageText(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)}m`
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}
