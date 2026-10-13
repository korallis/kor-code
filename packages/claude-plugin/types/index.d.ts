// The cockpit's state contract: every value the hooks module keeps in `$.state`.

/** Mirrors core's Provenance (a hooks module imports only files inside its plugin); `fixture` is the README's "Illustrative". */
export type KorProvenance = 'live' | 'stale' | 'fixture' | 'unavailable'

export type KorViewId =
  | 'cockpit'
  | 'issue'
  | 'project'
  | 'decisions'
  | 'decision'
  | 'agents'
  | 'agent'
  | 'accounts'
  | 'context'
  | 'linear'
  | 'overrides'

/** One cockpit view; `target` names the decision or agent a drill-down shows. */
export type KorView = { id: KorViewId; target?: string }

/** A manual action on a fixture decision; reverting keeps the record visible. */
export type KorOverride = {
  id: string
  decisionId: string
  action: 'apply' | 'override' | 'evidence' | 'reevaluate'
  choice: string
  at: string
  isReverted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'kor-code-cockpit': {
      view: KorView
      /** Events of the fixture execution shown; null shows all of them. */
      cursor: number | null
      overrides: KorOverride[]
    }
  }
}
