// Kor Code Mission Control: the motion plan as shared StyleX styles. Keyframes
// stay private to this module (StyleX resolves them per file); components
// compose the exported styles. Durations come from the `motion` tokens, which
// collapse to zero under prefers-reduced-motion.
import * as stylex from '@stylexjs/stylex';
import { motion } from './tokens.stylex';
/** Card entrance: fade, a 6 px rise and blur to sharp. */
const rise = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' },
  to: { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
});

/** Terminal lines slide up 4 px and fade in. */
const lineIn = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(4px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

/** The glowing dot of an active status pill. */
const dotPulse = stylex.keyframes({
  '0%': { opacity: 1, transform: 'scale(1)' },
  '50%': { opacity: 0.45, transform: 'scale(0.8)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
});

/** The current stage segment breathes. */
const stageGlow = stylex.keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.55 },
  '100%': { opacity: 1 },
});

/** The needs-you card's amber edge breathes between 0.12 and 0.35. */
const amberBreathe = stylex.keyframes({
  '0%': { boxShadow: '0 0 0 1px rgba(251, 191, 36, 0.12), 0 0 32px -8px rgba(251, 191, 36, 0.12)' },
  '50%': { boxShadow: '0 0 0 1px rgba(251, 191, 36, 0.3), 0 0 36px -6px rgba(251, 191, 36, 0.35)' },
  '100%': { boxShadow: '0 0 0 1px rgba(251, 191, 36, 0.12), 0 0 32px -8px rgba(251, 191, 36, 0.12)' },
});

/** The nav badge ripples once every six seconds. */
const ripple = stylex.keyframes({
  '0%': { boxShadow: '0 0 0 0 rgba(251, 191, 36, 0.55)' },
  '12%': { boxShadow: '0 0 0 6px rgba(251, 191, 36, 0)' },
  '100%': { boxShadow: '0 0 0 0 rgba(251, 191, 36, 0)' },
});

/** The block cursor blinks in steps. */
const blink = stylex.keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0 },
  '100%': { opacity: 1 },
});

/** A probability bar grows from zero. */
const grow = stylex.keyframes({ from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } });

/** The primary button's gradient shifts on hover. */
const spin = stylex.keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } });

export const animate = stylex.create({
  /** Card entrance: fade, 6 px rise, blur to sharp; first mount only. */
  rise: { animationName: rise, animationDuration: motion.slow, animationTimingFunction: motion.easeOut, animationFillMode: 'both' },
  /** The needs-you card: entrance, then the amber edge breathes. */
  riseBreathe: {
    animationName: `${rise}, ${amberBreathe}`,
    animationDuration: `${motion.slow}, ${motion.breathe}`,
    animationIterationCount: `1, ${motion.loop}`,
    animationTimingFunction: `${motion.easeOut}, ease-in-out`,
    animationFillMode: 'both',
  },
  lineIn: { animationName: lineIn, animationDuration: motion.fast, animationTimingFunction: motion.easeOut },
  fadeIn: { animationName: fadeIn, animationDuration: motion.slow, animationFillMode: 'both' },
  fadeInFast: { animationName: fadeIn, animationDuration: motion.base, animationFillMode: 'both' },
  dotPulse: { animationName: dotPulse, animationDuration: motion.pulse, animationIterationCount: motion.loop, animationTimingFunction: 'ease-in-out' },
  stageGlow: { animationName: stageGlow, animationDuration: motion.pulse, animationIterationCount: motion.loop, animationTimingFunction: 'ease-in-out' },
  ripple: { animationName: ripple, animationDuration: '6s', animationIterationCount: motion.loop },
  blink: { animationName: blink, animationDuration: '1s', animationTimingFunction: 'steps(1)', animationIterationCount: motion.loop },
  grow: { transformOrigin: 'left center', animationName: grow, animationDuration: motion.slow, animationTimingFunction: motion.easeOut, animationFillMode: 'both' },
  spin: { animationName: spin, animationDuration: '1s', animationIterationCount: 'infinite', animationTimingFunction: 'linear' },
  spinSlow: { animationName: spin, animationDuration: '14s', animationIterationCount: motion.loop, animationTimingFunction: 'linear' },
  spinFast: { animationName: spin, animationDuration: '1.4s', animationIterationCount: motion.loop, animationTimingFunction: 'linear' },
});

/** Stagger an entrance by its position: 40 ms a step. */
export const stagger = stylex.create({ at: (index: number) => ({ animationDelay: `calc(${motion.stagger} * ${index})` }) });
/** Delay a reveal (decision sections appear in sequence). */
export const delayBy = stylex.create({ ms: (ms: number) => ({ animationDelay: `${ms}ms` }) });
