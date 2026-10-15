// Explore alternatives: every decision Jev made for the run, each candidate a
// button that asks the daemon to override (policy checks decide; refusals are
// shown with their reason). The route can move to any verified model, and the
// next session's skills, playbook and tools can be edited.
import * as stylex from '@stylexjs/stylex';
import { Check, GitCompareArrows, Undo2 } from 'lucide-react';
import type { MissionRun } from '@kor-code/mission-control';
import type { DecisionRecord } from '@kor-code/core';
import { ApiFailure } from '../api/client';
import { useOverrides } from '../api/data';
import { useModels, useOverride, useRevertOverride } from '../api/queries';
import { color, font, fontSize, space, tint, tracking } from '../theme/tokens.stylex';
import { Button } from '../ui/button';
import { Dialog, Notice } from '../ui/misc';
import { Pill } from '../ui/pill';
import { layout } from '../ui/layout';
import { text } from '../ui/text';
import { prob } from '../lib/format';
import { SessionPackEditor } from './SessionPackEditor';

// The route and the next session's skills, playbook and tools have their own editors.
const EDITED_KINDS = new Set(['route', 'skills', 'playbook', 'tools']);

const styles = stylex.create({
  group: { display: 'flex', flexDirection: 'column', gap: space.s2, paddingBlock: space.s3, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine },
  kind: { fontFamily: font.mono, fontSize: fontSize.microPlus, letterSpacing: tracking.label, textTransform: 'uppercase', color: color.violetBright },
  reasons: { fontSize: fontSize.sm, color: color.textMuted },
});

export function OverrideDialog({ run, decisions, onClose }: { run: MissionRun; decisions: readonly DecisionRecord[]; onClose: () => void }) {
  const override = useOverride();
  const revert = useRevertOverride();
  const models = useModels();
  const records = useOverrides().filter(record => record.executionId === run.executionId);
  const verified = (models.data?.models.value ?? []).filter(model => model.compatibility === 'verified').map(model => model.id);
  const result = override.data?.record;
  const error = override.error ?? revert.error;
  const latestByKind = new Map<string, DecisionRecord>();
  for (const decision of decisions) latestByKind.set(decision.kind, decision);
  return (
    <Dialog title={`Explore alternatives · ${run.issueKey ?? run.issueId}`} onClose={onClose} wide icon={<GitCompareArrows size={18} />}>
      <p {...stylex.props(text.secondary, text.base)}>Pick another candidate and Kor applies it from the next attempt, after its policy checks. A refused override is recorded with the reason.</p>
      {result && <Notice tone={result.status === 'applied' ? 'ok' : 'warn'} title={`${result.status === 'applied' ? 'Applied' : 'Refused'}: ${result.target} → ${result.choice}`} hint={result.reason} />}
      {error && <Notice title={error.message} hint={error instanceof ApiFailure ? error.hint : undefined} />}
      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(layout.row)}><span {...stylex.props(styles.kind)}>route</span><span {...stylex.props(text.mono, text.sm)}>{run.route?.model ?? 'no route yet'}</span><Pill tone="ghost" small>{run.routeSource ?? '—'}</Pill></div>
        <div {...stylex.props(layout.rowWrap)}>
          {verified.filter(model => model !== run.route?.model).map(model => (
            <Button key={model} size="sm" busy={override.isPending && override.variables?.choice === model && override.variables.target === 'route'} onClick={() => override.mutate({ executionId: run.executionId, target: 'route', choice: model })}>{model}</Button>
          ))}
          {verified.length === 0 && <span {...stylex.props(styles.reasons)}>{models.error ? `Models unavailable: ${models.error.message}` : 'No verified models: run a probe on the Models screen first.'}</span>}
        </div>
      </div>
      <SessionPackEditor executionId={run.executionId} />
      {[...latestByKind.values()].filter(decision => !EDITED_KINDS.has(decision.kind)).map(decision => (
        <div key={decision.decisionId} {...stylex.props(styles.group)}>
          <div {...stylex.props(layout.row)}><span {...stylex.props(styles.kind)}>{decision.kind}</span><span {...stylex.props(text.mono, text.sm)}>{decision.choice}</span><span {...stylex.props(text.mono, text.muted, text.xs)}>{prob(decision.confidence)}</span></div>
          <span {...stylex.props(styles.reasons)}>{decision.reasons.join(' · ')}</span>
          <div {...stylex.props(layout.rowWrap)}>
            {decision.candidates.filter(candidate => candidate !== decision.choice).map(candidate => (
              <Button key={candidate} size="sm" busy={override.isPending && override.variables?.choice === candidate} onClick={() => override.mutate({ executionId: run.executionId, target: decision.decisionId, choice: candidate, decisionId: decision.decisionId })}>{candidate}</Button>
            ))}
            {decision.candidates.length <= 1 && <span {...stylex.props(styles.reasons)}>Jev considered no alternative.</span>}
          </div>
        </div>
      ))}
      {records.length > 0 && (
        <div {...stylex.props(styles.group)}>
          <span {...stylex.props(styles.kind)}>your overrides</span>
          {records.map(record => (
            <div key={record.id} {...stylex.props(layout.row)}>
              <Pill tone={record.status === 'applied' ? 'cyan' : record.status === 'rejected' ? 'rose' : 'slate'} small>{record.status}</Pill>
              <span {...stylex.props(text.mono, text.sm, text.ellipsis)}>{record.target} → {record.choice}</span>
              <span {...stylex.props(layout.grow)} />
              {record.status === 'applied' && <Button size="sm" variant="ghost" icon={Undo2} busy={revert.isPending && revert.variables === record.id} onClick={() => revert.mutate(record.id)}>Revert</Button>}
              {record.status !== 'applied' && <span {...stylex.props(styles.reasons)}>{record.reason}</span>}
            </div>
          ))}
        </div>
      )}
      <div {...stylex.props(layout.row)}><span {...stylex.props(layout.grow)} /><Button icon={Check} onClick={onClose}>Done</Button></div>
    </Dialog>
  );
}
