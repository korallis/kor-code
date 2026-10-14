import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Loader } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { color, font, glow, gradient, motion, radius, tint } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';
import { BrandMark, Icon } from './icon';
import type { Brand } from './brands';

const styles = stylex.create({
  btn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', height: '32px', paddingInline: '13px', borderRadius: '9px',
    fontSize: '13px', fontWeight: 500, color: color.text, backgroundColor: { default: tint.ghost, ':hover': tint.ghostStrong },
    borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairlineStrong, whiteSpace: 'nowrap', cursor: 'pointer', flex: 'none',
    transitionProperty: 'background-color, box-shadow, filter, opacity', transitionDuration: motion.fast,
    outline: 'none', boxShadow: { default: null, ':focus-visible': glow.focus },
  },
  sm: { height: '27px', paddingInline: '10px', fontSize: '12px', borderRadius: '8px', gap: '6px' },
  lg: { height: '40px', paddingInline: '18px', fontSize: '14px', borderRadius: '11px' },
  primary: {
    backgroundImage: gradient.primaryButton, backgroundSize: '115% 100%', backgroundPosition: { default: '0% 0%', ':hover': '100% 0%' },
    borderColor: 'transparent', boxShadow: { default: glow.button, ':focus-visible': glow.focus }, color: tint.white, fontWeight: 600,
    transitionProperty: 'background-position, box-shadow, opacity',
  },
  ok: { color: color.green, borderColor: tint.greenEdgeStrong, backgroundColor: tint.greenFill },
  warn: { color: color.amber, borderColor: tint.amberEdgeStrong, backgroundColor: tint.amberFill },
  danger: { color: color.rose, borderColor: tint.roseEdge, backgroundColor: tint.roseFill },
  dangerGhost: { color: color.rose, borderColor: 'transparent', backgroundColor: { default: 'transparent', ':hover': tint.roseFill } },
  ghost: { backgroundColor: { default: 'transparent', ':hover': tint.ghost }, borderColor: 'transparent', color: color.textSecondary },
  violet: { color: color.violetBright, borderColor: tint.violetEdgeStrong, backgroundColor: tint.violetFill },
  icon: { width: '32px', paddingInline: 0 },
  iconSm: { width: '27px', paddingInline: 0 },
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
  kbd: { fontFamily: font.mono, fontSize: '10px', lineHeight: 1, paddingBlock: '4px', paddingInline: '6px', borderRadius: '5px', borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairlineStrong, color: color.textMuted, backgroundColor: tint.ghost },
  full: { width: '100%' },
  grow: { flex: '1' },
  radius: { borderRadius: radius.md },
});

export type ButtonVariant = 'default' | 'primary' | 'ok' | 'warn' | 'danger' | 'danger-ghost' | 'ghost' | 'violet';
interface Props {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  brand?: Brand;
  iconOnly?: boolean;
  label?: string;
  kbd?: string;
  busy?: boolean;
  disabled?: boolean;
  full?: boolean;
  grow?: boolean;
  href?: string;
  external?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  style?: stylex.StyleXStyles;
}

const VARIANT = { default: null, primary: styles.primary, ok: styles.ok, warn: styles.warn, danger: styles.danger, 'danger-ghost': styles.dangerGhost, ghost: styles.ghost, violet: styles.violet } as const;

export function Button({ children, variant = 'default', size = 'md', icon, brand, iconOnly = false, label, kbd, busy = false, disabled = false, full = false, grow = false, href, external = false, type = 'button', title, onClick, style }: Props) {
  const glyphSize = size === 'sm' ? 13 : 15;
  const glyph = busy ? <Icon icon={Loader} size={glyphSize} style={animate.spin} /> : icon ? <Icon icon={icon} size={glyphSize} /> : brand ? <BrandMark brand={brand} size={glyphSize} /> : null;
  const classes = stylex.props(styles.btn, size === 'sm' && styles.sm, size === 'lg' && styles.lg, VARIANT[variant], iconOnly && (size === 'sm' ? styles.iconSm : styles.icon), (disabled || busy) && styles.disabled, full && styles.full, grow && styles.grow, style);
  const content = <>{glyph}{children}{kbd && <span {...stylex.props(styles.kbd)}>{kbd}</span>}</>;
  if (href !== undefined && !disabled) {
    return <a href={href} aria-label={label} title={title ?? label} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...classes} onClick={onClick}>{content}</a>;
  }
  return <button type={type} aria-label={label} title={title ?? label} disabled={disabled || busy} aria-busy={busy} {...classes} onClick={onClick}>{content}</button>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.kbd)}>{children}</span>;
}
