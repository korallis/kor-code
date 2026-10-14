import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { color, font, glow, gradient, layout as dims, radius, space, tint } from '../theme/tokens.stylex';
import { animate, stagger } from '../theme/animate';
import { Icon } from './icon';

const styles = stylex.create({
  card: {
    position: 'relative', borderRadius: radius.lg, minWidth: 0,
    backgroundImage: gradient.glassSheen, backgroundColor: color.surface,
    borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline,
    boxShadow: glow.card, backdropFilter: `blur(${dims.glassBlur})`,
  },
  pad: { padding: space.s5 },
  clip: { overflow: 'hidden' },
  flex: { display: 'flex', flexDirection: 'column', minHeight: 0 },
  neon: { borderColor: 'transparent', boxShadow: glow.cardNeon },
  neonEdge: {
    position: 'absolute', inset: '-1px', borderRadius: 'inherit', padding: '1px', pointerEvents: 'none',
    backgroundImage: gradient.neonBorder,
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor', maskComposite: 'exclude',
  },
  attn: {
    borderColor: tint.attentionEdge,
    backgroundImage: tint.attention,
    boxShadow: `${tint.attentionGlow}, ${glow.card}`,
  },
  insight: { backgroundImage: `${tint.insight}` },
  head: { display: 'flex', alignItems: 'center', gap: '10px', paddingBlock: `${space.s4} ${space.s3}`, paddingInline: space.s5 },
  title: { fontFamily: font.display, fontSize: '15px', fontWeight: 600, letterSpacing: '.005em', display: 'flex', alignItems: 'center', gap: '9px', whiteSpace: 'nowrap' },
  titleIcon: { color: color.violetBright },
  aside: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: space.s2, minWidth: 0 },
  body: { paddingInline: space.s5, paddingBottom: space.s5 },
  countChip: { fontFamily: font.mono, fontSize: '11px', paddingBlock: '1px', paddingInline: '7px', borderRadius: radius.sm, backgroundColor: tint.violetChip, color: color.violetBright, fontWeight: 500 },
});

export type CardVariant = 'plain' | 'neon' | 'attention' | 'insight';

export function Card({ variant = 'plain', pad = false, clip = false, flex = false, index = 0, as: Tag = 'section', children, style, label }: {
  variant?: CardVariant; pad?: boolean; clip?: boolean; flex?: boolean; index?: number; as?: 'section' | 'div' | 'article'; children: ReactNode; style?: stylex.StyleXStyles; label?: string;
}) {
  return (
    <Tag aria-label={label} {...stylex.props(styles.card, variant === 'attention' ? animate.riseBreathe : animate.rise, variant === 'neon' && styles.neon, variant === 'attention' && styles.attn, variant === 'insight' && styles.insight, pad && styles.pad, clip && styles.clip, flex && styles.flex, stagger.at(index), style)}>
      {variant === 'neon' && <span {...stylex.props(styles.neonEdge)} aria-hidden="true" />}
      {children}
    </Tag>
  );
}

export function CardHeader({ icon, title, count, aside }: { icon?: LucideIcon; title: ReactNode; count?: ReactNode; aside?: ReactNode }) {
  return (
    <header {...stylex.props(styles.head)}>
      <h2 {...stylex.props(styles.title)}>
        {icon && <Icon icon={icon} style={styles.titleIcon} />}
        {title}
        {count !== undefined && <span {...stylex.props(styles.countChip)}>{count}</span>}
      </h2>
      {aside && <div {...stylex.props(styles.aside)}>{aside}</div>}
    </header>
  );
}

export function CardBody({ children, style }: { children: ReactNode; style?: stylex.StyleXStyles }) {
  return <div {...stylex.props(styles.body, style)}>{children}</div>;
}

export function CountChip({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.countChip)}>{children}</span>;
}
