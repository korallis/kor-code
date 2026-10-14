// Jev's one identity: a violet plasma orb with a cyan orbit ring. Higgsfield
// loops (idle, thinking, deciding) play over a coded orb that stands in for them.
import * as stylex from '@stylexjs/stylex';
import { motion, tint } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';
import { MotionMedia } from '../motion/MotionMedia';

const ping = stylex.keyframes({
  from: { transform: 'scale(1)', opacity: 0.9 },
  to: { transform: 'scale(2.1)', opacity: 0 },
});
const breathe = stylex.keyframes({
  '0%': { filter: 'brightness(1)' },
  '50%': { filter: 'brightness(1.18)' },
  '100%': { filter: 'brightness(1)' },
});

const styles = stylex.create({
  orb: { position: 'relative', flex: 'none', borderRadius: '50%', backgroundImage: tint.orbFill, boxShadow: tint.orbGlow, display: 'block', animationName: breathe, animationDuration: '6s', animationIterationCount: motion.loop, animationTimingFunction: 'ease-in-out' },
  ring: { position: 'absolute', inset: '-4px', borderRadius: '50%', borderWidth: '1px', borderStyle: 'solid', borderColor: tint.orbRing, borderLeftColor: 'transparent', borderBottomColor: 'transparent', transform: 'rotate(-20deg)' },
  ringSmall: { inset: '-3px' },
  ping: { position: 'absolute', inset: 0, borderRadius: '50%', borderWidth: '1.5px', borderStyle: 'solid', borderColor: tint.orbRing, animationName: ping, animationDuration: '1.2s', animationIterationCount: 1, animationFillMode: 'both', animationTimingFunction: motion.easeOut },
  media: { flex: 'none' },
});
const sized = stylex.create({ size: (px: number) => ({ width: `${px}px`, height: `${px}px` }) });

export type OrbState = 'idle' | 'thinking' | 'deciding';
const SLOT = { idle: 'jev-orb-idle', thinking: 'jev-orb-thinking', deciding: 'jev-orb-deciding' } as const;

export function JevOrb({ size = 36, state = 'idle', playKey }: { size?: number; state?: OrbState; playKey?: string | number }) {
  const fallback = (
    <span {...stylex.props(styles.orb, sized.size(size))}>
      <span {...stylex.props(styles.ring, size <= 26 && styles.ringSmall, state === 'thinking' ? animate.spinFast : animate.spinSlow)} />
      {state === 'deciding' && <span key={playKey} {...stylex.props(styles.ping)} />}
    </span>
  );
  return <MotionMedia slot={SLOT[state]} fallback={fallback} round contain once={state === 'deciding'} playKey={playKey} style={[styles.media, sized.size(size)]} label="Jev" />;
}
