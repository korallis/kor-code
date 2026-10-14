// Shared typography: the mono IDs, eyebrows and muted ramps every screen uses.
import * as stylex from '@stylexjs/stylex';
import { color, font, fontSize, fontWeight, gradient, tracking } from '../theme/tokens.stylex';

export const text = stylex.create({
  mono: { fontFamily: font.mono },
  display: { fontFamily: font.display },
  num: { fontFamily: font.display, fontVariantNumeric: 'tabular-nums' },
  muted: { color: color.textMuted },
  faint: { color: color.textFaint },
  secondary: { color: color.textSecondary },
  strong: { color: color.text, fontWeight: fontWeight.medium },
  key: { fontFamily: font.mono, color: color.violetBright, fontWeight: fontWeight.medium },
  link: { color: color.cyan },
  grad: { backgroundImage: gradient.brandText, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' },
  ellipsis: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  nowrap: { whiteSpace: 'nowrap' },
  eyebrow: { fontFamily: font.mono, fontSize: '10.5px', letterSpacing: tracking.label, textTransform: 'uppercase', color: color.textMuted },
  label: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: tracking.label, textTransform: 'uppercase', color: color.textFaint },
  micro: { fontSize: fontSize.micro },
  xs: { fontSize: fontSize.xs },
  sm: { fontSize: fontSize.sm },
  base: { fontSize: fontSize.base },
  md: { fontSize: fontSize.md },
  lg: { fontSize: fontSize.lg },
  violet: { color: color.violetBright },
  cyan: { color: color.cyan },
  green: { color: color.green },
  amber: { color: color.amber },
  orange: { color: color.orange },
  rose: { color: color.rose },
  sky: { color: color.sky },
  magenta: { color: color.magenta },
  slate: { color: color.slate },
  right: { textAlign: 'right' },
  strike: { textDecoration: 'line-through' },
});

export type Tone = 'violet' | 'cyan' | 'green' | 'amber' | 'orange' | 'rose' | 'sky' | 'magenta' | 'slate';
