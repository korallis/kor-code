import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { tint } from '../theme/tokens.stylex';

const styles = stylex.create({
  mark: { width: '34px', height: '34px', filter: tint.markGlow, flex: 'none' },
  a: { stopColor: tint.markStart }, b: { stopColor: tint.markMid }, c: { stopColor: tint.markEnd },
  coreWhite: { stopColor: tint.white }, core: { stopColor: tint.markCore }, coreEnd: { stopColor: tint.markEnd },
  hex: { fill: tint.markFill },
  dot: { fill: tint.white },
});

/** The Kor Code mark: a hexagon holding a "K" drawn as a decision node. */
export function KorMark() {
  const id = useId();
  return (
    <svg viewBox="0 0 36 36" role="img" aria-label="Kor Code" {...stylex.props(styles.mark)}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" {...stylex.props(styles.a)} /><stop offset=".5" {...stylex.props(styles.b)} /><stop offset="1" {...stylex.props(styles.c)} /></linearGradient>
        <radialGradient id={`${id}c`}><stop offset="0" {...stylex.props(styles.coreWhite)} /><stop offset=".35" stopOpacity=".9" {...stylex.props(styles.core)} /><stop offset="1" stopOpacity="0" {...stylex.props(styles.coreEnd)} /></radialGradient>
      </defs>
      <path d="M18 2.6 31.3 10.3v15.4L18 33.4 4.7 25.7V10.3z" stroke={`url(#${id}g)`} strokeWidth="1.5" strokeLinejoin="round" {...stylex.props(styles.hex)} />
      <path d="M13 10.8v14.4" stroke={`url(#${id}g)`} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M23.4 10.8 16 18l7.4 7.2" fill="none" stroke={`url(#${id}g)`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="18" r="6" fill={`url(#${id}c)`} opacity=".7" />
      <circle cx="16" cy="18" r="2.3" {...stylex.props(styles.dot)} />
    </svg>
  );
}
