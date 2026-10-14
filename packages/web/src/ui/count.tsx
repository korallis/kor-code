// Live counters count to their new value over the base duration with tabular
// figures. A ref callback drives the frames, so React never re-renders per frame
// and no effect is needed; reduced motion jumps straight to the value.
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({ num: { fontVariantNumeric: 'tabular-nums' } });

const DURATION = 200;

export function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const target = format(value);
  const animate = (node: HTMLSpanElement | null) => {
    if (!node) return;
    const from = Number(node.dataset.value ?? 'NaN');
    node.dataset.value = String(value);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!Number.isFinite(from) || from === value || reduced) { node.textContent = target; return; }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - (1 - t) ** 3;
      node.textContent = t >= 1 ? target : format(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  };
  return <span aria-label={target} ref={animate} {...stylex.props(styles.num)} />;
}
