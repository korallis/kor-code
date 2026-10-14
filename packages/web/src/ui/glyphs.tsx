import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Aperture, CircleSlash2, Cpu } from 'lucide-react';
import type { ReactNode } from 'react';
import { color, font, tint } from '../theme/tokens.stylex';
import { BrandMark, Icon } from './icon';
import type { Tone } from './text';
import { toneSolid, toneStroke, toneStyles } from './tone';

const styles = stylex.create({
  prio: { display: 'inline-flex', alignItems: 'flex-end', gap: '1.5px', height: '12px', flex: 'none' },
  prioBar: { width: '3px', borderRadius: '1px', backgroundColor: color.textFaint },
  h1: { height: '5px' }, h2: { height: '8px' }, h3: { height: '11px' },
  lit: { backgroundColor: color.textSecondary },
  urgent: { width: '13px', height: '13px', borderRadius: '3px', backgroundColor: color.orange, color: tint.urgentInk, fontWeight: 700, fontSize: '10px', lineHeight: '13px', textAlign: 'center', display: 'inline-block', boxShadow: tint.urgentGlow, flex: 'none' },
  none: { color: color.textFaint, fontFamily: font.mono, fontSize: '11px' },
  state: { position: 'relative', width: '14px', height: '14px', borderRadius: '50%', borderWidth: '1.6px', borderStyle: 'solid', borderColor: color.textMuted, display: 'inline-block', flex: 'none' },
  backlog: { borderStyle: 'dashed', borderColor: color.textFaint },
  todo: { borderColor: color.textSecondary },
  progress: { borderColor: color.amber, backgroundImage: `conic-gradient(${color.amber} 0 50%, transparent 50% 100%)`, backgroundClip: 'content-box', padding: '2px' },
  review: { borderColor: color.green, backgroundImage: `conic-gradient(${color.green} 0 75%, transparent 75% 100%)`, backgroundClip: 'content-box', padding: '2px' },
  done: { borderColor: color.violet, backgroundColor: color.violet },
  tick: { position: 'absolute', left: '3.5px', top: '1.5px', width: '3px', height: '6px', borderStyle: 'solid', borderColor: tint.checkInk, borderWidth: '0 1.6px 1.6px 0', transform: 'rotate(45deg)' },
  cancel: { borderColor: color.textFaint, backgroundColor: color.textFaint },
  prov: { width: '28px', height: '28px', borderRadius: '8px', display: 'grid', placeItems: 'center', flex: 'none', borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairlineStrong, color: color.textSecondary },
  provLg: { width: '38px', height: '38px', borderRadius: '11px' },
  claude: { color: tint.providerClaude, backgroundColor: tint.providerClaudeFill, borderColor: tint.providerClaudeEdge },
  codex: { color: tint.providerCodex, backgroundColor: tint.providerCodexFill, borderColor: tint.providerCodexEdge },
  grok: { color: tint.providerGrok, backgroundColor: tint.providerGrokFill },
  copilot: { color: tint.providerCopilot, backgroundColor: tint.providerCopilotFill, borderColor: tint.providerCopilotEdge },
  swatch: { width: '8px', height: '8px', borderRadius: '3px', flex: 'none', boxShadow: '0 0 8px currentColor' },
  tile: { width: '30px', height: '30px', borderRadius: '9px', display: 'grid', placeItems: 'center', fontFamily: font.display, fontWeight: 700, fontSize: '12px', flex: 'none', borderWidth: '1px', borderStyle: 'solid' },
  feedDot: { width: '22px', height: '22px', borderRadius: '7px', display: 'grid', placeItems: 'center', flex: 'none', borderWidth: '1px', borderStyle: 'solid' },
});

/** Linear's priority bars (1 urgent … 4 low, 0 none). */
export function Priority({ value }: { value: number }) {
  if (value === 1) return <span {...stylex.props(styles.urgent)} title="Urgent">!</span>;
  if (value === 0) return <span {...stylex.props(styles.none)} title="No priority">—</span>;
  const lit = value === 2 ? 3 : value === 3 ? 2 : 1;
  return (
    <span {...stylex.props(styles.prio)} title={['', '', 'High', 'Medium', 'Low'][value]}>
      <i {...stylex.props(styles.prioBar, styles.h1, lit >= 1 && styles.lit)} />
      <i {...stylex.props(styles.prioBar, styles.h2, lit >= 2 && styles.lit)} />
      <i {...stylex.props(styles.prioBar, styles.h3, lit >= 3 && styles.lit)} />
    </span>
  );
}

export type LinearStateKind = 'backlog' | 'todo' | 'progress' | 'review' | 'done' | 'cancel';
/** Map a Linear state type and name to the glyph. "In Review" is a started state with its own glyph. */
export function linearStateKind(type: string | undefined, name: string | undefined): LinearStateKind {
  if (type === 'completed') return 'done';
  if (type === 'canceled' || type === 'duplicate') return 'cancel';
  if (type === 'started') return /review/i.test(name ?? '') ? 'review' : 'progress';
  if (type === 'unstarted') return 'todo';
  if (/review/i.test(name ?? '')) return 'review';
  if (/progress/i.test(name ?? '')) return 'progress';
  if (/done|merged|complete/i.test(name ?? '')) return 'done';
  if (/todo/i.test(name ?? '')) return 'todo';
  return 'backlog';
}
export function LinearState({ kind }: { kind: LinearStateKind }) {
  return <span {...stylex.props(styles.state, styles[kind])}>{kind === 'done' && <span {...stylex.props(styles.tick)} />}</span>;
}

export type ProviderKind = 'claude' | 'codex' | 'grok' | 'copilot' | 'other';
export function providerKind(name: string | undefined): ProviderKind {
  const value = (name ?? '').toLowerCase();
  if (/claude|anthropic/.test(value)) return 'claude';
  if (/codex|openai|gpt|chatgpt/.test(value)) return 'codex';
  if (/grok|xai/.test(value)) return 'grok';
  if (/copilot|github/.test(value)) return 'copilot';
  return 'other';
}
const PROVIDER_ICON: Record<'codex' | 'grok' | 'other', LucideIcon> = { codex: Aperture, grok: CircleSlash2, other: Cpu };
export function ProviderBadge({ provider, large = false }: { provider: ProviderKind; large?: boolean }) {
  const size = large ? 20 : 15;
  return (
    <span {...stylex.props(styles.prov, large && styles.provLg, provider !== 'other' && styles[provider])}>
      {provider === 'claude' ? <BrandMark brand="claude" size={size} /> : provider === 'copilot' ? <BrandMark brand="githubcopilot" size={size} /> : <Icon icon={PROVIDER_ICON[provider]} size={size} />}
    </span>
  );
}

export function Swatch({ tone }: { tone: Tone }) {
  return <span {...stylex.props(styles.swatch, toneStroke[tone], toneSolid[tone])} />;
}

export function Tile({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span {...stylex.props(styles.tile, toneStyles[tone])}>{children}</span>;
}

export function FeedDot({ tone, icon }: { tone: Tone; icon: LucideIcon }) {
  return <span {...stylex.props(styles.feedDot, toneStyles[tone])}><Icon icon={icon} size={13} /></span>;
}
