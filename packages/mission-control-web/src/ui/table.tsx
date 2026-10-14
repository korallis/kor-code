import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { color, font, tint, tracking } from '../theme/tokens.stylex';

const sized = stylex.create({ width: (width: string) => ({ width }) });

const styles = stylex.create({
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' },
  fixed: { tableLayout: 'fixed' },
  th: { fontFamily: font.mono, fontSize: '9.5px', letterSpacing: tracking.label, textTransform: 'uppercase', color: color.textFaint, fontWeight: 500, textAlign: 'left', paddingInline: '10px', paddingBottom: '9px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline, whiteSpace: 'nowrap' },
  td: { paddingInline: '10px', height: '42px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis' },
  tall: { height: '47px' },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },
  sel: { backgroundColor: tint.selectedRow },
  selEdge: { boxShadow: `inset 2px 0 0 ${color.violetNeon}` },
  click: { cursor: 'pointer', backgroundColor: { default: null, ':hover': tint.ghost } },
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
export function Tr({ children, onClick, label }: { children: ReactNode; onClick?: () => void; label?: string }) {
  return <tr aria-label={label} onClick={onClick} {...stylex.props(onClick && styles.click)}>{children}</tr>;
}
