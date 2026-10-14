// Pieces several screens share: the page frame, run cards, query states.
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import type { MissionRun } from '@kor-code/mission-control';
import { ApiFailure } from '../api/client';
import { color, font, fontSize, space, tint, tracking } from '../theme/tokens.stylex';
import { href } from '../router';
import { ProvenanceChip, StatusPill } from '../ui/pill';
import { StageTrack } from '../ui/stages';
import { text } from '../ui/text';
import { Notice } from '../ui/misc';
import { usd, shortModel } from '../lib/format';
import { keyOf, slotOf } from '../lib/runs';
import { duration } from '../lib/time';

const NARROW = '@media (max-width: 1499px)';

export const page = stylex.create({
  page: { padding: { default: space.s6, [NARROW]: space.s5 }, display: 'flex', flexDirection: 'column', gap: space.s4, minWidth: 0 },
  fill: { height: '100%', minHeight: '720px' },
  head: { display: 'flex', alignItems: 'flex-end', gap: space.s4, flexWrap: 'wrap' },
  title: { fontFamily: font.display, fontSize: fontSize.page, fontWeight: 600, letterSpacing: tracking.snug, lineHeight: 1.1 },
  lede: { color: color.textSecondary, fontSize: fontSize.md, marginTop: space.s1h },
});

const styles = stylex.create({
  run: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '7px 12px', paddingBlock: space.s2h, paddingInline: space.s3, borderRadius: '11px', borderWidth: '1px', borderStyle: 'solid', borderColor: tint.rowLine, backgroundColor: { default: tint.ghost, ':hover': tint.ghostStrong }, marginBottom: space.s2, color: color.text },
  waiting: { borderColor: tint.magentaEdge, backgroundColor: color.magentaDim },
  t: { fontSize: fontSize.base, fontWeight: 500, display: 'flex', gap: space.s2, alignItems: 'center', minWidth: 0 },
  m: { gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'auto minmax(60px, 1fr) auto', gap: space.s3, alignItems: 'center', fontFamily: font.mono, fontSize: fontSize.xs, color: color.textMuted },
});

export function RunRow({ run, now }: { run: MissionRun; now: number }) {
  const detail = run.status === 'waiting' ? 'your go-ahead' : run.status === 'running' && run.startedAt ? duration(now - Date.parse(run.startedAt)) : run.stage;
  return (
    <a href={href('agents', run.executionId)} {...stylex.props(styles.run, run.status === 'waiting' && styles.waiting)}>
      <div {...stylex.props(styles.t)}><span {...stylex.props(text.key)}>{keyOf(run)}</span><span {...stylex.props(text.ellipsis)}>{run.issueTitle ?? run.issueId}</span></div>
      <StatusPill status={run.status} detail={detail} small />
      <div {...stylex.props(styles.m)}>
        <span {...stylex.props(text.ellipsis)}>{shortModel(run.route?.model)}{slotOf(run) ? ` · ${slotOf(run)}` : ''}</span>
        <StageTrack stage={run.stage} status={run.status} />
        <span>{usd(run.costUsd)}</span>
      </div>
    </a>
  );
}

/** A query that failed: say what and why, never an empty panel. */
export function QueryError({ error, what }: { error: Error; what: string }) {
  return <Notice title={`${what} unavailable: ${error.message}`} hint={error instanceof ApiFailure ? error.hint : undefined} />;
}

export function Unavailable({ reason, children }: { reason?: string | undefined; children: ReactNode }) {
  return <ProvenanceChip provenance="unavailable" reason={reason}>{children}</ProvenanceChip>;
}
