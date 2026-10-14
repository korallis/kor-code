// Plain-SVG charts from the approved component sheet: bar, ring, sparkline,
// donut and trend. Colours come from tone styles, never literals.
import * as stylex from '@stylexjs/stylex';
import { useId, type ReactNode } from 'react';
import { color, gradient, motion, radius, tint } from '../theme/tokens.stylex';
import type { Tone } from './text';
import { toneStop, toneStroke } from './tone';

const styles = stylex.create({
  bar: { position: 'relative', height: '6px', borderRadius: radius.pill, backgroundColor: tint.track, overflow: 'hidden', minWidth: '24px' },
  thin: { height: '4px' },
  thick: { height: '8px' },
  fill: { position: 'absolute', insetBlock: 0, left: 0, borderRadius: radius.pill, backgroundImage: gradient.progress, boxShadow: tint.barGlowCyan, transitionProperty: 'width', transitionDuration: motion.slow, transitionTimingFunction: motion.easeOut },
  green: { backgroundImage: gradient.progressGreen, boxShadow: tint.barGlowGreen },
  amber: { backgroundImage: tint.barAmber, boxShadow: tint.barGlowAmber },
  rose: { backgroundImage: tint.barRose, boxShadow: tint.barGlowRose },
  svg: { display: 'block', overflow: 'visible' },
  track: { stroke: tint.track, fill: 'none' },
  arc: { fill: 'none', strokeLinecap: 'round', transitionProperty: 'stroke-dasharray', transitionDuration: motion.slow, transitionTimingFunction: motion.easeOut },
  line: { fill: 'none', strokeWidth: 1.8, filter: 'drop-shadow(0 0 4px currentColor)' },
  end: { fill: tint.white, filter: 'drop-shadow(0 0 5px currentColor)' },
  rotate: { transform: 'rotate(-90deg)' },
  ringWrap: { position: 'relative', display: 'grid', placeItems: 'center', flex: 'none' },
  ringLabel: { position: 'absolute', textAlign: 'center', lineHeight: 1.1 },
  axis: { stroke: color.hairline, strokeWidth: 1 },
});
const fillWidth = stylex.create({ w: (pct: number) => ({ width: `${Math.max(0, Math.min(100, pct))}%` }) });

export type BarTone = 'brand' | 'green' | 'amber' | 'rose';
export function Bar({ pct, tone = 'brand', size = 'md', label }: { pct: number; tone?: BarTone; size?: 'thin' | 'md' | 'thick'; label?: string }) {
  return (
    <div role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label} {...stylex.props(styles.bar, size === 'thin' && styles.thin, size === 'thick' && styles.thick)}>
      <i {...stylex.props(styles.fill, tone !== 'brand' && styles[tone], fillWidth.w(pct))} />
    </div>
  );
}

/** Catmull-Rom through the points, as cubic Béziers. */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!, p1 = points[i]!, p2 = points[i + 1]!, p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]!.toFixed(1)},${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)},${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function scale(values: readonly number[], w: number, h: number, pad = 2, min = Math.min(...values), max = Math.max(...values)): [number, number][] {
  const span = max - min || 1;
  const step = values.length > 1 ? (w - 2 * pad) / (values.length - 1) : 0;
  return values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - 2 * pad)]);
}

export function Spark({ values, tone, width = 96, height = 40, fill = true, label, min, max }: { values: readonly number[]; tone: Tone; width?: number; height?: number; fill?: boolean; label: string; min?: number; max?: number }) {
  const id = useId();
  if (values.length < 2) return null;
  const pts = scale(values, width, height, 3, min, max);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1]!;
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...stylex.props(styles.svg, toneStroke[tone])}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopOpacity=".35" {...stylex.props(toneStop[tone])} /><stop offset="1" stopOpacity="0" {...stylex.props(toneStop[tone])} /></linearGradient></defs>
      {fill && <path d={`${line} L${last[0]},${height} L${pts[0]![0]},${height} Z`} fill={`url(#${id})`} stroke="none" />}
      <path d={line} {...stylex.props(styles.line, toneStroke[tone])} />
      <circle cx={last[0]} cy={last[1]} r="2.6" {...stylex.props(styles.end)} />
    </svg>
  );
}

export function Ring({ pct, size = 64, stroke = 6, from = 'violet', to = 'cyan', label, children }: { pct: number; size?: number; stroke?: number; from?: Tone; to?: Tone; label: string; children?: ReactNode }) {
  const id = useId();
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div role="img" aria-label={label} {...stylex.props(styles.ringWrap)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} {...stylex.props(styles.svg, styles.rotate)}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" {...stylex.props(toneStop[from])} /><stop offset="1" {...stylex.props(toneStop[to])} /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} {...stylex.props(styles.track)} />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke={`url(#${id})`} strokeDasharray={`${(c * clamped / 100).toFixed(1)} ${c.toFixed(1)}`} {...stylex.props(styles.arc, toneStroke[to])} />
      </svg>
      {children && <div {...stylex.props(styles.ringLabel)}>{children}</div>}
    </div>
  );
}

export function Donut({ parts, size = 150, stroke = 14, gap = 3, label, children }: { parts: readonly { value: number; tone: Tone }[]; size?: number; stroke?: number; gap?: number; label: string; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  let offset = 0;
  return (
    <div role="img" aria-label={label} {...stylex.props(styles.ringWrap)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} {...stylex.props(styles.svg, styles.rotate)}>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} {...stylex.props(styles.track)} />
        {total > 0 && parts.map((part, index) => {
          const len = Math.max((part.value / total) * c - (parts.length > 1 ? gap : 0), 0);
          const arc = <circle key={index} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={`${len.toFixed(1)} ${c.toFixed(1)}`} strokeDashoffset={(-offset).toFixed(1)} {...stylex.props(styles.arc, styles.line, toneStroke[part.tone])} />;
          offset += (part.value / total) * c;
          return arc;
        })}
      </svg>
      {children && <div {...stylex.props(styles.ringLabel)}>{children}</div>}
    </div>
  );
}
