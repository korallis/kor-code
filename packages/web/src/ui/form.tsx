import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { color, font, fontSize, glow, gradient, motion, radius, space, tint } from '../theme/tokens.stylex';
import { Icon } from './icon';

const styles = stylex.create({
  field: {
    display: 'flex', alignItems: 'center', gap: space.s2, height: '34px', paddingInline: '11px', borderRadius: '9px', backgroundColor: color.surfaceSunken,
    borderWidth: '1px', borderStyle: 'solid', borderColor: { default: color.hairlineStrong, ':focus-within': 'transparent' },
    boxShadow: { default: null, ':focus-within': glow.focus }, color: color.textMuted, fontSize: fontSize.base,
    transitionProperty: 'box-shadow, border-color', transitionDuration: motion.fast, minWidth: 0,
  },
  input: { flex: '1', minWidth: 0, width: '100%', backgroundColor: 'transparent', borderWidth: 0, outline: 'none', color: color.text, fontSize: 'inherit', MozAppearance: 'textfield', '::placeholder': { color: color.textMuted }, '::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 }, '::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 } },
  mono: { fontFamily: font.mono, fontSize: fontSize.sm },
  area: {
    width: '100%', resize: 'vertical', paddingBlock: space.s2h, paddingInline: space.s3, borderRadius: radius.md, backgroundColor: color.surfaceSunken,
    borderWidth: '1px', borderStyle: 'solid', borderColor: { default: color.hairlineStrong, ':focus': 'transparent' }, boxShadow: { default: null, ':focus': glow.focus },
    outline: 'none', color: color.text, fontSize: fontSize.base, lineHeight: 1.5, '::placeholder': { color: color.textMuted },
    transitionProperty: 'box-shadow, border-color', transitionDuration: motion.fast,
  },
  toggle: { position: 'relative', width: '32px', height: '18px', borderRadius: radius.pill, backgroundColor: tint.ghostStrong, flex: 'none', cursor: 'pointer', borderWidth: 0, transitionProperty: 'background-color', transitionDuration: motion.base },
  toggleOn: { backgroundImage: gradient.primaryButton, boxShadow: tint.toggleOnGlow },
  knob: { position: 'absolute', top: '2px', left: '2px', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: tint.toggleKnob, transitionProperty: 'transform', transitionDuration: motion.base, transitionTimingFunction: motion.easeOut },
  knobOn: { transform: 'translateX(14px)', backgroundColor: tint.white },
  toggleRow: { display: 'inline-flex', alignItems: 'center', gap: space.s2, fontSize: fontSize.sm, color: color.textSecondary, cursor: 'pointer' },
  seg: { display: 'inline-flex', padding: '3px', borderRadius: radius.md, backgroundColor: color.surfaceSunken, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, gap: space.s0, flex: 'none' },
  segItem: { paddingBlock: '5px', paddingInline: '11px', borderRadius: '7px', fontSize: fontSize.sm, color: { default: color.textMuted, ':hover': color.textSecondary }, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', transitionProperty: 'background-color, color', transitionDuration: motion.fast },
  segOn: { color: color.text, backgroundImage: tint.segOn, boxShadow: `inset 0 0 0 1px ${tint.violetEdgeStrong}` },
  check: { width: '16px', height: '16px', borderRadius: '5px', borderWidth: '1.5px', borderStyle: 'solid', borderColor: color.hairlineStrong, display: 'grid', placeItems: 'center', color: tint.white, flex: 'none', cursor: 'pointer', backgroundColor: 'transparent' },
  checkOn: { backgroundImage: gradient.primaryButton, borderColor: 'transparent', boxShadow: tint.toggleOnGlow },
  select: { appearance: 'none', backgroundColor: 'transparent', borderWidth: 0, outline: 'none', color: color.text, flex: '1', minWidth: 0, fontFamily: font.mono, fontSize: fontSize.sm, cursor: 'pointer' },
  option: { backgroundColor: color.canvas, color: color.text },
  label: { fontSize: fontSize.base, color: color.textSecondary },
});

export function TextInput({ value, onChange, placeholder, icon, mono = false, type = 'text', label, onEnter, autoFocus = false, style, trailing }: {
  value: string; onChange: (value: string) => void; placeholder?: string; icon?: LucideIcon; mono?: boolean; type?: 'text' | 'password' | 'url' | 'number'; label: string; onEnter?: () => void; autoFocus?: boolean; style?: stylex.StyleXStyles; trailing?: ReactNode;
}) {
  return (
    <label {...stylex.props(styles.field, style)}>
      {icon && <Icon icon={icon} size={15} />}
      <input aria-label={label} type={type} value={value} placeholder={placeholder} autoFocus={autoFocus} data-autofocus={autoFocus ? '' : undefined} autoComplete="off" spellCheck={false}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' && onEnter) { event.preventDefault(); onEnter(); } }}
        {...stylex.props(styles.input, mono && styles.mono)} />
      {trailing}
    </label>
  );
}

export function TextArea({ value, onChange, placeholder, label, rows = 4, mono = false, onSubmit, style }: {
  value: string; onChange: (value: string) => void; placeholder?: string; label: string; rows?: number; mono?: boolean; onSubmit?: () => void; style?: stylex.StyleXStyles;
}) {
  return (
    <textarea aria-label={label} value={value} placeholder={placeholder} rows={rows} spellCheck={false}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => { if (onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit(); } }}
      {...stylex.props(styles.area, mono && styles.mono, style)} />
  );
}

export function Toggle({ on, onChange, label, children }: { on: boolean; onChange: (on: boolean) => void; label: string; children?: ReactNode }) {
  const control = (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} {...stylex.props(styles.toggle, on && styles.toggleOn)}>
      <span {...stylex.props(styles.knob, on && styles.knobOn)} />
    </button>
  );
  if (!children) return control;
  return <span {...stylex.props(styles.toggleRow)}>{control}<span onClick={() => onChange(!on)}>{children}</span></span>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: ReactNode }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} {...stylex.props(styles.seg)}>
      {options.map(option => (
        <button key={option.value} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)} {...stylex.props(styles.segItem, option.value === value && styles.segOn)}>{option.label}</button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={event => { event.stopPropagation(); onChange(!checked); }} {...stylex.props(styles.check, checked && styles.checkOn)}>
      {checked && <Icon icon={Check} size={11} />}
    </button>
  );
}

export function Select<T extends string>({ value, options, onChange, label, style }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label: string; style?: stylex.StyleXStyles }) {
  return (
    <label {...stylex.props(styles.field, style)}>
      <select aria-label={label} value={value} onChange={event => onChange(event.target.value as T)} {...stylex.props(styles.select)}>
        {options.map(option => <option key={option.value} value={option.value} {...stylex.props(styles.option)}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.label)}>{children}</span>;
}
