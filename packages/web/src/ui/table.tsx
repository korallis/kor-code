import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { color, font, fontSize, space, tint, tracking } from '../theme/tokens.stylex';

const sized = stylex.create({ width: (width: string) => ({ width }) });

const styles = stylex.create({
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' },
  fixed: { tableLayout: 'fixed' },
  th: { fontFamily: font.mono, fontSize: fontSize.nano, letterSpacing: tracking.label, textTransform: 'uppercase', color: color.textFaint, fontWeight: 500, textAlign: 'left', paddingInline: space.s2h, paddingBottom: '9px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline, whiteSpace: 'nowrap' },
  td: { paddingInline: space.s2h, height: '42px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: fontSize.base, overflow: 'hidden', textOverflow: 'ellipsis' },
  tall: { height: '47px' },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },
  sel: { backgroundColor: tint.selectedRow },
  selEdge: { boxShadow: `inset 2px 0 0 ${color.violetNeon}` },
  click: { cursor: 'pointer', backgroundColor: { default: null, ':hover': tint.ghost, ':focus-visible': tint.ghost }, outline: { default: null, ':focus-visible': `1px solid ${color.violetBright}` }, outlineOffset: '-1px' },
});

export function Table({ children, fixed = false, label }: { children: ReactNode; fixed?: boolean; label: string }) {
  return <table aria-label={label} {...stylex.props(styles.table, fixed && styles.fixed)}>{children}</table>;
}
export function Th({ children, align, width }: { children?: ReactNode; align?: 'right' | 'center'; width?: string }) {
  return <th {...stylex.props(styles.th, width !== undefined && sized.width(width), align === 'right' && styles.right, align === 'center' && styles.center)}>{children}</th>;
}
export function Td({ children, align, first = false, selected = false, tall = false, style, colSpan }: { children?: ReactNode; align?: 'right' | 'center'; first?: boolean; selected?: boolean; tall?: boolean; style?: stylex.StyleXStyles; colSpan?: number }) {
  return <td colSpan={colSpan} {...stylex.props(styles.td, tall && styles.tall, align === 'right' && styles.right, align === 'center' && styles.center, selected && styles.sel, selected && first && styles.selEdge, style)}>{children}</td>;
}
/** A row; with onClick it is also focusable and opens with Enter or Space, so it never depends on a mouse. */
export function Tr({ children, onClick, label }: { children: ReactNode; onClick?: () => void; label?: string }) {
  if (!onClick) return <tr aria-label={label}>{children}</tr>;
  return (
    <tr aria-label={label} tabIndex={0} role="link" onClick={onClick}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } }}
      {...stylex.props(styles.click)}>{children}</tr>
  );
}
