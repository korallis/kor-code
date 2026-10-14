import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { color, font, fontSize, gradient, motion, space, tint } from '../theme/tokens.stylex';
import { Icon } from './icon';

const styles = stylex.create({
  tabs: { display: 'flex', gap: space.s1, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline, overflowX: 'auto', scrollbarWidth: 'none', flex: 'none' },
  tab: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '7px', paddingBlock: space.s2h, paddingInline: space.s3, fontSize: fontSize.md, color: { default: color.textMuted, ':hover': color.textSecondary }, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', transitionProperty: 'color', transitionDuration: motion.fast },
  on: { color: color.text },
  bar: { position: 'absolute', left: '8px', right: '8px', bottom: '-1px', height: '2px', borderRadius: '2px', backgroundImage: gradient.brand, boxShadow: tint.tabGlow },
  count: { fontFamily: font.mono, fontSize: fontSize.xs, paddingBlock: '1px', paddingInline: '7px', borderRadius: '6px', backgroundColor: tint.ghostStrong, color: color.textSecondary },
  ptabs: { display: 'inline-flex', gap: space.s1, flex: 'none' },
  ptab: { paddingBlock: space.s1h, paddingInline: space.s3, borderRadius: '8px', fontSize: fontSize.sm, color: { default: color.textMuted, ':hover': color.textSecondary }, fontWeight: 500, borderWidth: '1px', borderStyle: 'solid', borderColor: 'transparent', display: 'inline-flex', gap: space.s1h, alignItems: 'center', whiteSpace: 'nowrap', cursor: 'pointer' },
  ptabOn: { color: color.text, borderColor: tint.violetEdgeStrong, backgroundColor: tint.ptabOn, boxShadow: tint.ptabGlow },
  ptabCount: { color: color.textMuted, fontFamily: font.mono, fontSize: fontSize.xs },
});

export interface TabItem<T extends string> { value: T; label: ReactNode; icon?: LucideIcon; count?: ReactNode }

export function Tabs<T extends string>({ value, items, onChange, label }: { value: T; items: readonly TabItem<T>[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} {...stylex.props(styles.tabs)}>
      {items.map(item => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === value} onClick={() => onChange(item.value)} {...stylex.props(styles.tab, item.value === value && styles.on)}>
          {item.icon && <Icon icon={item.icon} size={15} />}
          {item.label}
          {item.count !== undefined && <span {...stylex.props(styles.count)}>{item.count}</span>}
          {item.value === value && <span {...stylex.props(styles.bar)} />}
        </button>
      ))}
    </div>
  );
}

export function PillTabs<T extends string>({ value, items, onChange, label }: { value: T; items: readonly TabItem<T>[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} {...stylex.props(styles.ptabs)}>
      {items.map(item => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === value} onClick={() => onChange(item.value)} {...stylex.props(styles.ptab, item.value === value && styles.ptabOn)}>
          {item.label}{item.count !== undefined && <span {...stylex.props(styles.ptabCount)}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
