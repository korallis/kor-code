// Kor Code Mission Control: design tokens.
//
// This file is the single source of truth, taken from the approved design. Every
// component imports its values from here; no value is written twice. Every value
// is an inline literal because the StyleX compiler must evaluate `defineVars`
// statically.

import * as stylex from '@stylexjs/stylex';

/** Surfaces, text and the two neon accents. Dark only: Mission Control is a night-sky product. */
export const color = stylex.defineVars({
  // Canvas: deep navy, never pure black.
  canvas: '#05081a',
  canvasDeep: '#03050f',
  canvasGlowViolet: 'rgba(124, 58, 237, 0.22)',
  canvasGlowCyan: 'rgba(34, 211, 238, 0.10)',

  // Glass surfaces (used over the canvas with a backdrop blur).
  surface: 'rgba(16, 22, 52, 0.62)',
  surfaceRaised: 'rgba(24, 32, 74, 0.72)',
  surfaceSunken: 'rgba(6, 10, 28, 0.72)',
  surfaceHover: 'rgba(40, 48, 110, 0.45)',
  surfaceSelected: 'rgba(124, 92, 255, 0.16)',

  // Hairlines.
  hairline: 'rgba(132, 146, 255, 0.13)',
  hairlineStrong: 'rgba(150, 160, 255, 0.26)',
  hairlineAccent: 'rgba(167, 139, 250, 0.55)',

  // Text.
  text: '#eef1ff',
  textSecondary: '#aab3d9',
  textMuted: '#7079a6',
  textFaint: '#4a5380',
  textOnAccent: '#0b0720',

  // Brand accents.
  violet: '#8b5cf6',
  violetBright: '#a78bfa',
  violetNeon: '#b388ff',
  violetDeep: '#5b21b6',
  cyan: '#22d3ee',
  cyanBright: '#67e8f9',
  magenta: '#e879f9',
  blue: '#5b8cff',

  // Semantic tones.
  green: '#34e5a1',
  greenDim: 'rgba(52, 229, 161, 0.14)',
  amber: '#fbbf24',
  amberDim: 'rgba(251, 191, 36, 0.14)',
  orange: '#fb923c',
  orangeDim: 'rgba(251, 146, 60, 0.14)',
  rose: '#fb7185',
  roseDim: 'rgba(251, 113, 133, 0.14)',
  sky: '#60a5fa',
  skyDim: 'rgba(96, 165, 250, 0.14)',
  violetDim: 'rgba(167, 139, 250, 0.16)',
  cyanDim: 'rgba(34, 211, 238, 0.13)',
  magentaDim: 'rgba(232, 121, 249, 0.14)',
  slate: '#8a93b8',
  slateDim: 'rgba(138, 147, 184, 0.14)',

  // Code and diff.
  codeBg: 'rgba(3, 6, 20, 0.78)',
  diffAddBg: 'rgba(52, 229, 161, 0.10)',
  diffAddText: '#7ef0c2',
  diffDelBg: 'rgba(251, 113, 133, 0.10)',
  diffDelText: '#fda4af',
  syntaxKeyword: '#c4a7ff',
  syntaxString: '#7ef0c2',
  syntaxFunction: '#67e8f9',
  syntaxComment: '#5b648f',
  syntaxNumber: '#fbbf24',
});

/** Gradients: the brand sweep runs violet to cyan, left to right. */
export const gradient = stylex.defineVars({
  brand: 'linear-gradient(90deg, #a78bfa 0%, #818cf8 45%, #22d3ee 100%)',
  brandDiagonal: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #22d3ee 100%)',
  brandText: 'linear-gradient(92deg, #c4b5fd 0%, #a78bfa 30%, #67e8f9 100%)',
  neonBorder: 'linear-gradient(135deg, rgba(179, 136, 255, 0.85) 0%, rgba(99, 102, 241, 0.35) 45%, rgba(34, 211, 238, 0.75) 100%)',
  glassSheen: 'linear-gradient(180deg, rgba(255, 255, 255, 0.045) 0%, rgba(255, 255, 255, 0) 38%)',
  progress: 'linear-gradient(90deg, #8b5cf6 0%, #22d3ee 100%)',
  progressGreen: 'linear-gradient(90deg, #10b981 0%, #34e5a1 100%)',
  primaryButton: 'linear-gradient(135deg, #8b5cf6 0%, #6d5dfc 55%, #3fb8f5 100%)',
  canvas: 'radial-gradient(1200px 700px at 12% -10%, rgba(124, 58, 237, 0.22), transparent 60%), radial-gradient(900px 600px at 100% 0%, rgba(34, 211, 238, 0.10), transparent 60%), radial-gradient(1000px 800px at 60% 120%, rgba(91, 33, 182, 0.18), transparent 60%)',
});

/** Soft neon glow. Glow marks focus and live things; it is never decoration on static text. */
export const glow = stylex.defineVars({
  card: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 18px 40px -18px rgba(0, 0, 0, 0.7)',
  cardNeon: '0 0 0 1px rgba(167, 139, 250, 0.32), 0 0 22px -2px rgba(139, 92, 246, 0.38), 0 0 60px -12px rgba(34, 211, 238, 0.22)',
  violet: '0 0 18px rgba(139, 92, 246, 0.55)',
  cyan: '0 0 16px rgba(34, 211, 238, 0.55)',
  green: '0 0 12px rgba(52, 229, 161, 0.6)',
  amber: '0 0 14px rgba(251, 191, 36, 0.55)',
  rose: '0 0 14px rgba(251, 113, 133, 0.55)',
  focus: '0 0 0 1px rgba(167, 139, 250, 0.9), 0 0 0 4px rgba(139, 92, 246, 0.22), 0 0 28px rgba(139, 92, 246, 0.35)',
  button: '0 8px 24px -8px rgba(124, 58, 237, 0.75), 0 0 0 1px rgba(196, 181, 253, 0.35) inset',
});

/** Type: a display grotesk for headings and numbers, Inter for UI, JetBrains Mono for code, IDs and labels. */
export const font = stylex.defineVars({
  display: '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", system-ui, sans-serif',
  sans: '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
});

export const fontSize = stylex.defineVars({
  micro: '10px',
  xs: '11px',
  sm: '12px',
  base: '13px',
  md: '14px',
  lg: '16px',
  xl: '19px',
  xxl: '24px',
  xxxl: '32px',
  display: '46px',
});

export const fontWeight = stylex.defineVars({
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
});

export const lineHeight = stylex.defineVars({
  tight: '1.15',
  snug: '1.35',
  body: '1.5',
  code: '1.65',
});

/** Letter spacing for the mono eyebrow labels ("ACTIVE PROJECTS"). */
export const tracking = stylex.defineVars({
  tight: '-0.02em',
  normal: '0',
  label: '0.12em',
  wide: '0.32em',
});

/** A 4 px grid. */
export const space = stylex.defineVars({
  s0: '2px',
  s1: '4px',
  s2: '8px',
  s3: '12px',
  s4: '16px',
  s5: '20px',
  s6: '24px',
  s7: '28px',
  s8: '32px',
  s10: '40px',
  s12: '48px',
});

export const radius = stylex.defineVars({
  xs: '4px',
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '18px',
  pill: '999px',
});

export const layout = stylex.defineVars({
  topBarHeight: '64px',
  sidebarWidth: '232px',
  statusBarHeight: '40px',
  rightPanelWidth: '344px',
  glassBlur: '18px',
});


/** Durations collapse to 0 under reduced motion, so every component inherits it. */
export const motion = stylex.defineVars({
  fast: { default: '120ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
  base: { default: '200ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
  slow: { default: '420ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
  pulse: { default: '1.8s', '@media (prefers-reduced-motion: reduce)': '0s' },
  breathe: { default: '2.4s', '@media (prefers-reduced-motion: reduce)': '0s' },
  stagger: { default: '40ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** `infinite` normally; a single run under reduced motion stops pulses and blinks. */
  loop: { default: 'infinite', '@media (prefers-reduced-motion: reduce)': '1' },
});

/**
 * Run status to tone. Covers every `RunLifecycle` value in
 * packages/core/src/index.ts so a new status fails review here, not on screen.
 */
export const statusTone = stylex.defineConsts({
  queued: 'slate',
  ready: 'sky',
  evaluating: 'violet',
  running: 'cyan',
  waiting: 'magenta',
  verifying: 'cyan',
  repairing: 'orange',
  shipping: 'sky',
  review: 'violet',
  blocked: 'amber',
  complete: 'green',
  failed: 'rose',
  escalated: 'orange',
  canceled: 'slate',
});

/**
 * Tinted edges, fills and chrome from the approved component sheet (kor.css).
 * Kept here so components never write a colour literal.
 */
export const tint = stylex.defineVars({
  violetEdge: 'rgba(167, 139, 250, 0.3)',
  cyanEdge: 'rgba(34, 211, 238, 0.3)',
  greenEdge: 'rgba(52, 229, 161, 0.3)',
  amberEdge: 'rgba(251, 191, 36, 0.32)',
  orangeEdge: 'rgba(251, 146, 60, 0.32)',
  roseEdge: 'rgba(251, 113, 133, 0.32)',
  skyEdge: 'rgba(96, 165, 250, 0.3)',
  magentaEdge: 'rgba(232, 121, 249, 0.3)',
  slateEdge: 'rgba(138, 147, 184, 0.26)',
  ghost: 'rgba(255, 255, 255, 0.03)',
  ghostStrong: 'rgba(255, 255, 255, 0.06)',
  track: 'rgba(255, 255, 255, 0.06)',
  stageTrack: 'rgba(255, 255, 255, 0.07)',
  rowLine: 'rgba(132, 146, 255, 0.07)',
  topBar: 'linear-gradient(180deg, rgba(8, 11, 32, 0.92), rgba(6, 9, 26, 0.70))',
  sideBar: 'linear-gradient(180deg, rgba(8, 12, 34, 0.72), rgba(5, 8, 24, 0.55))',
  statusBar: 'rgba(4, 7, 22, 0.85)',
  navActive: 'linear-gradient(90deg, rgba(139, 92, 246, 0.22), rgba(99, 102, 241, 0.08) 70%, rgba(34, 211, 238, 0.04))',
  navActiveShadow: 'inset 0 0 0 1px rgba(167, 139, 250, 0.28), 0 0 24px -6px rgba(139, 92, 246, 0.45)',
  jevCard: 'linear-gradient(135deg, rgba(139, 92, 246, 0.16), rgba(34, 211, 238, 0.06))',
  jevCardEdge: 'rgba(167, 139, 250, 0.25)',
  jevAnswer: 'linear-gradient(135deg, rgba(139, 92, 246, 0.10), rgba(34, 211, 238, 0.04))',
  insight: 'linear-gradient(150deg, rgba(139, 92, 246, 0.16), rgba(34, 211, 238, 0.05) 60%)',
  attention: 'linear-gradient(160deg, rgba(251, 191, 36, 0.08), rgba(16, 22, 52, 0) 45%)',
  attentionEdge: 'rgba(251, 191, 36, 0.35)',
  attentionGlow: '0 0 0 1px rgba(251, 191, 36, 0.12), 0 0 32px -8px rgba(251, 191, 36, 0.35)',
  attentionGlowHigh: '0 0 0 1px rgba(251, 191, 36, 0.3), 0 0 40px -6px rgba(251, 191, 36, 0.55)',
  selectedRow: 'rgba(139, 92, 246, 0.09)',
  segOn: 'linear-gradient(135deg, rgba(139, 92, 246, 0.35), rgba(34, 211, 238, 0.14))',
  ptabOn: 'rgba(139, 92, 246, 0.14)',
  ptabGlow: '0 0 16px -4px rgba(139, 92, 246, 0.5)',
  tabGlow: '0 0 10px rgba(139, 92, 246, 0.8)',
  orbFill: 'radial-gradient(circle at 35% 30%, #f5f3ff 0%, #c4b5fd 12%, #8b5cf6 38%, #4c1d95 70%, #1e1b4b 100%)',
  orbGlow: '0 0 0 1px rgba(196, 181, 253, 0.4), 0 0 18px rgba(139, 92, 246, 0.7), 0 0 36px rgba(34, 211, 238, 0.25)',
  orbRing: 'rgba(103, 232, 249, 0.35)',
  avatar: 'linear-gradient(135deg, #312e81, #1e1b4b)',
  toggleKnob: '#cbd5ff',
  white: '#ffffff',
  barAmber: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
  barRose: 'linear-gradient(90deg, #e11d48, #fb7185)',
  barGlowCyan: '0 0 12px rgba(34, 211, 238, 0.45)',
  barGlowGreen: '0 0 10px rgba(52, 229, 161, 0.45)',
  barGlowAmber: '0 0 10px rgba(251, 191, 36, 0.45)',
  barGlowRose: '0 0 10px rgba(251, 113, 133, 0.45)',
  stageDone: 'linear-gradient(90deg, rgba(139, 92, 246, 0.85), rgba(129, 140, 248, 0.85))',
  stageNowGlow: '0 0 10px rgba(34, 211, 238, 0.8)',
  stageWarnGlow: '0 0 10px rgba(251, 191, 36, 0.8)',
  stageRepairGlow: '0 0 10px rgba(251, 146, 60, 0.8)',
  stageWaitGlow: '0 0 10px rgba(232, 121, 249, 0.8)',
  wellSoft: 'rgba(5, 8, 22, 0.55)',
  codeHead: 'rgba(255, 255, 255, 0.02)',
  violetFill: 'rgba(139, 92, 246, 0.1)',
  violetChip: 'rgba(167, 139, 250, 0.14)',
  violetSoftEdge: 'rgba(167, 139, 250, 0.22)',
  violetSoftFill: 'rgba(139, 92, 246, 0.07)',
  greenFill: 'rgba(52, 229, 161, 0.07)',
  amberFill: 'rgba(251, 191, 36, 0.07)',
  roseFill: 'rgba(251, 113, 133, 0.06)',
  greenEdgeStrong: 'rgba(52, 229, 161, 0.35)',
  amberEdgeStrong: 'rgba(251, 191, 36, 0.35)',
  violetEdgeStrong: 'rgba(167, 139, 250, 0.35)',
  liveGreenFill: 'rgba(52, 229, 161, 0.06)',
  unavailFill: 'rgba(138, 147, 184, 0.06)',
  amberChipFill: 'rgba(251, 191, 36, 0.06)',
  illusEdge: 'rgba(232, 121, 249, 0.4)',
  illusFill: 'rgba(232, 121, 249, 0.07)',
  urgentInk: '#1a0d00',
  checkInk: '#0b0720',
  urgentGlow: '0 0 10px rgba(251, 146, 60, 0.5)',
  toggleOnGlow: '0 0 10px rgba(139, 92, 246, 0.5)',
  heroHalo: 'radial-gradient(circle, rgba(139, 92, 246, 0.22), transparent 62%)',
  cyanHalo: 'radial-gradient(closest-side, rgba(34, 211, 238, 0.13), transparent)',
  starField: 'radial-gradient(1px 1px at 20px 30px, rgba(255, 255, 255, 0.35), transparent 60%), radial-gradient(1px 1px at 140px 90px, rgba(196, 181, 253, 0.28), transparent 60%), radial-gradient(1px 1px at 260px 170px, rgba(103, 232, 249, 0.22), transparent 60%), radial-gradient(1px 1px at 330px 40px, rgba(255, 255, 255, 0.18), transparent 60%)',
  dotGrid: 'radial-gradient(rgba(150, 160, 255, 0.07) 1px, transparent 1.2px)',
  dotGridMask: 'radial-gradient(1200px 800px at 50% 30%, #000 30%, transparent 85%)',
  scrim: 'rgba(3, 5, 15, 0.72)',
  providerClaude: '#f29b6c',
  providerClaudeFill: 'rgba(217, 119, 87, 0.14)',
  providerClaudeEdge: 'rgba(242, 155, 108, 0.3)',
  providerCodex: '#8ff0d0',
  providerCodexFill: 'rgba(16, 163, 127, 0.14)',
  providerCodexEdge: 'rgba(143, 240, 208, 0.3)',
  providerGrok: '#e5e7ff',
  providerGrokFill: 'rgba(229, 231, 255, 0.08)',
  providerCopilot: '#a5b4fc',
  providerCopilotFill: 'rgba(99, 102, 241, 0.16)',
  providerCopilotEdge: 'rgba(165, 180, 252, 0.3)',
});
