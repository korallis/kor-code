// Shared layout atoms: rows, stacks and grids on the 4 px spacing scale.
import * as stylex from '@stylexjs/stylex';
import { color, space } from '../theme/tokens.stylex';

export const layout = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: space.s2, minWidth: 0 },
  rowTop: { display: 'flex', alignItems: 'flex-start', gap: space.s2, minWidth: 0 },
  rowWrap: { display: 'flex', alignItems: 'center', gap: space.s2, flexWrap: 'wrap', minWidth: 0 },
  stack: { display: 'flex', flexDirection: 'column', gap: space.s4, minHeight: 0, minWidth: 0 },
  stackTight: { display: 'flex', flexDirection: 'column', gap: space.s2, minWidth: 0 },
  stackXs: { display: 'flex', flexDirection: 'column', gap: space.s1, minWidth: 0 },
  grow: { flex: '1', minWidth: 0 },
  none: { flex: 'none' },
  gap1: { gap: space.s1 },
  gap3: { gap: space.s3 },
  gap4: { gap: space.s4 },
  mt1: { marginTop: space.s1 },
  mt2: { marginTop: space.s2 },
  mt3: { marginTop: space.s3 },
  mt4: { marginTop: space.s4 },
  mlAuto: { marginLeft: 'auto' },
  divider: { height: '1px', backgroundColor: color.hairline, flex: 'none' },
  scroll: { overflowY: 'auto', minHeight: 0, scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  fill: { flex: '1', minHeight: 0, minWidth: 0 },
  relative: { position: 'relative' },
  srOnly: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
});
