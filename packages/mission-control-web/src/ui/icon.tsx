import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { BRAND_PATHS, type Brand } from './brands';

const styles = stylex.create({
  wrap: { display: 'inline-grid', placeItems: 'center', flex: 'none' },
});

/** A Lucide icon at the design's 1.8 stroke. */
export function Icon({ icon: Glyph, size = 16, style }: { icon: LucideIcon; size?: number; style?: stylex.StyleXStyles }) {
  return <span {...stylex.props(styles.wrap, style)} aria-hidden="true"><Glyph size={size} strokeWidth={1.8} /></span>;
}

/** A provider or service brand mark (Simple Icons, CC0). */
export function BrandMark({ brand, size = 16, style }: { brand: Brand; size?: number; style?: stylex.StyleXStyles }) {
  return (
    <span {...stylex.props(styles.wrap, style)} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d={BRAND_PATHS[brand]} /></svg>
    </span>
  );
}
