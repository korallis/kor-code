import * as stylex from '@stylexjs/stylex';
import type { RunLifecycle } from '@kor-code/core';
import type { Stage } from '@kor-code/mission-control';
import { color, font, fontSize, motion, space, tint, tracking } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';

/** The seven stages, in order (packages/claude-plugin/hooks/model.ts). */
export const STAGES: readonly Stage[] = ['discover', 'preflight', 'context', 'execute', 'supervise', 'verify', 'synchronise'];

const styles = stylex.create({
  track: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', minWidth: '0' },
  seg: { height: '5px', borderRadius: '3px', backgroundColor: tint.stageTrack, transitionProperty: 'background-color, box-shadow', transitionDuration: motion.slow, transitionTimingFunction: motion.easeOut },
  large: { height: '6px' },
  done: { backgroundImage: tint.stageDone },
  now: { backgroundColor: color.cyan, boxShadow: tint.stageNowGlow },
  warn: { backgroundColor: color.amber, boxShadow: tint.stageWarnGlow },
  repair: { backgroundColor: color.orange, boxShadow: tint.stageRepairGlow },
  wait: { backgroundColor: color.magenta, boxShadow: tint.stageWaitGlow },
  fail: { backgroundColor: color.rose, boxShadow: tint.barGlowRose },
  labels: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', fontFamily: font.mono, fontSize: fontSize.nano, letterSpacing: tracking.mono, textTransform: 'uppercase', color: color.textFaint, marginTop: space.s1h },
  labelDone: { color: color.textMuted },
  labelNow: { color: color.cyan },
});

type Mode = 'now' | 'warn' | 'repair' | 'wait' | 'fail' | 'done-all' | 'idle';
function modeFor(status: RunLifecycle): Mode {
  switch (status) {
    case 'waiting': return 'wait';
    case 'repairing': return 'repair';
    case 'blocked': case 'escalated': return 'warn';
    case 'failed': return 'fail';
    case 'review': case 'complete': return 'done-all';
    case 'queued': case 'canceled': return 'idle';
    default: return 'now';
  }
}

export function StageTrack({ stage, status, labels = false, large = false }: { stage: Stage; status: RunLifecycle; labels?: boolean; large?: boolean }) {
  const mode = modeFor(status);
  const current = STAGES.indexOf(stage);
  const segment = (index: number) => {
    if (mode === 'done-all') return styles.done;
    if (mode === 'idle') return index < current ? styles.done : null;
    if (index < current) return styles.done;
    if (index > current) return null;
    return mode === 'now' ? [styles.now, animate.stageGlow] : styles[mode];
  };
  return (
    <div role="img" aria-label={`stage ${stage}, ${status}`}>
      <div {...stylex.props(styles.track)}>
        {STAGES.map((name, index) => <i key={name} {...stylex.props(styles.seg, large && styles.large, segment(index))} />)}
      </div>
      {labels && (
        <div {...stylex.props(styles.labels)}>
          {STAGES.map((name, index) => <span key={name} {...stylex.props(index < current && styles.labelDone, index === current && mode !== 'done-all' && styles.labelNow)}>{name}</span>)}
        </div>
      )}
    </div>
  );
}
