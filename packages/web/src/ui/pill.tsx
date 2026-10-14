import * as stylex from '@stylexjs/stylex';
import type { Provenance, RunLifecycle } from '@kor-code/core';
import type { ReactNode } from 'react';
import { color, font, fontSize, radius, space, tint, tracking } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';
import type { Tone } from './text';
import { ACTIVE_STATUSES, toneOf, toneStyles } from './tone';

const styles = stylex.create({
  pill: { display: 'inline-flex', alignItems: 'center', gap: space.s1h, height: '22px', paddingInline: '9px', borderRadius: radius.pill, fontFamily: font.mono, fontSize: fontSize.xs, fontWeight: 500, whiteSpace: 'nowrap', borderWidth: '1px', borderStyle: 'solid', borderColor: 'transparent', flex: 'none' },
  sm: { height: '19px', paddingInline: '7px', fontSize: fontSize.microPlus },
  ghost: { color: color.textSecondary, backgroundColor: tint.ghost, borderColor: color.hairlineStrong },
  dot: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor', boxShadow: '0 0 8px currentColor', flex: 'none' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: font.mono, fontSize: fontSize.nano, letterSpacing: tracking.chip, textTransform: 'uppercase', paddingBlock: space.s0, paddingInline: space.s1h, borderRadius: radius.xs, borderWidth: '1px', borderStyle: 'solid', whiteSpace: 'nowrap', flex: 'none' },
  chipDot: { width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'currentColor', boxShadow: '0 0 6px currentColor' },
  live: { color: color.green, borderColor: tint.greenEdge, backgroundColor: tint.liveGreenFill },
  stale: { color: color.amber, borderColor: tint.amberEdge, backgroundColor: tint.amberChipFill },
  unavailable: { color: color.slate, borderColor: tint.slateEdge, backgroundColor: tint.unavailFill },
});

export function Pill({ tone, dot = false, pulse = false, small = false, children, title }: { tone: Tone | 'ghost'; dot?: boolean; pulse?: boolean; small?: boolean; children: ReactNode; title?: string }) {
  return (
    <span title={title} {...stylex.props(styles.pill, tone === 'ghost' ? styles.ghost : toneStyles[tone], small && styles.sm)}>
      {dot && <span {...stylex.props(styles.dot, pulse && animate.dotPulse)} />}
      {children}
    </span>
  );
}

/** A run status with its tone; the dot pulses only while something is happening. */
export function StatusPill({ status, detail, small = false }: { status: RunLifecycle; detail?: ReactNode; small?: boolean }) {
  return (
    <Pill tone={toneOf(status)} dot pulse={ACTIVE_STATUSES.has(status)} small={small}>
      {status}{detail !== undefined && detail !== null && detail !== '' && <> · {detail}</>}
    </Pill>
  );
}

/**
 * Kor's provenance rule, carried from the cockpit: every value that is not live
 * is labelled stale (with its age) or unavailable (with the reason as a title).
 */
export function ProvenanceChip({ provenance, children, reason }: { provenance: Provenance; children?: ReactNode; reason?: string | undefined }) {
  const kind = provenance === 'live' ? styles.live : provenance === 'stale' ? styles.stale : styles.unavailable;
  const word = provenance === 'fixture' ? 'fixture' : provenance;
  return (
    <span title={reason} {...stylex.props(styles.chip, kind)}>
      <span {...stylex.props(styles.chipDot)} />
      {children ?? word}
    </span>
  );
}
