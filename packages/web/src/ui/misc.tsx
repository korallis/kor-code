import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { color, font, fontSize, glow, gradient, layout as dims, motion, radius, space, tint } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';
import { MotionMedia } from '../motion/MotionMedia';
import type { MotionSlot } from '../motion/assets';
import { Button } from './button';
import { FeedDot } from './glyphs';
import { Icon } from './icon';
import type { Tone } from './text';

const styles = stylex.create({
  feed: { display: 'grid', gap: space.s0 },
  feedItem: { display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: space.s2h, alignItems: 'start', paddingBlock: space.s1h },
  what: { fontSize: fontSize.base, color: color.textSecondary, lineHeight: 1.4, minWidth: 0 },
  whatClamp: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  when: { fontFamily: font.mono, fontSize: fontSize.microPlus, color: color.textFaint, paddingTop: space.s0, whiteSpace: 'nowrap' },
  empty: { display: 'grid', placeItems: 'center', textAlign: 'center', gap: space.s2, paddingBlock: space.s6, paddingInline: space.s4, color: color.textMuted, fontSize: fontSize.base },
  emptyArt: { width: '200px', height: '110px', display: 'block' },
  emptyArtFallback: { display: 'block', width: '100%', height: '100%', borderRadius: '50%', backgroundImage: tint.heroHalo, opacity: 0.8 },
  emptyTitle: { color: color.textSecondary, fontWeight: 500 },
  notice: { display: 'flex', alignItems: 'flex-start', gap: space.s2h, paddingBlock: space.s2h, paddingInline: space.s3, borderRadius: radius.md, borderWidth: '1px', borderStyle: 'solid', fontSize: fontSize.smPlus, lineHeight: 1.45 },
  noticeErr: { color: color.rose, borderColor: tint.roseEdge, backgroundColor: tint.roseFill },
  noticeWarn: { color: color.amber, borderColor: tint.amberEdge, backgroundColor: tint.amberChipFill },
  noticeOk: { color: color.green, borderColor: tint.greenEdge, backgroundColor: tint.liveGreenFill },
  noticeBody: { color: color.textSecondary },
  noticeHint: { display: 'block', color: color.textMuted, fontFamily: font.mono, fontSize: fontSize.xs, marginTop: space.s0 },
  dialog: {
    position: 'fixed', inset: 0, margin: 'auto', width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', padding: 0,
    borderRadius: radius.xl, borderWidth: '1px', borderStyle: 'solid', borderColor: 'transparent', color: color.text,
    backgroundImage: gradient.glassSheen, backgroundColor: color.surfaceRaised, boxShadow: glow.cardNeon, backdropFilter: `blur(${dims.glassBlur})`,
    '::backdrop': { backgroundColor: tint.scrim, backdropFilter: 'blur(4px)' },
  },
  wide: { width: 'min(820px, calc(100vw - 32px))' },
  dialogHead: { display: 'flex', alignItems: 'center', gap: space.s3, paddingBlock: `${space.s5} ${space.s3}`, paddingInline: space.s6 },
  dialogTitle: { fontFamily: font.display, fontSize: fontSize.xl, fontWeight: 600 },
  dialogBody: { paddingInline: space.s6, paddingBottom: space.s6, display: 'flex', flexDirection: 'column', gap: space.s4, overflowY: 'auto' },
  splash: { position: 'absolute', inset: 0, zIndex: -1, opacity: 0.6, borderRadius: radius.xl, overflow: 'hidden' },
  push: { marginLeft: 'auto' },
  contents: { display: 'contents' },
  kv: { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: `${space.s1h} ${space.s3h}`, fontSize: fontSize.base },
  dt: { color: color.textMuted },
  dd: { color: color.text, textAlign: 'right', fontFamily: font.mono, fontSize: fontSize.sm, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

export function Feed({ children }: { children: ReactNode }) { return <div {...stylex.props(styles.feed)}>{children}</div>; }
export function FeedItem({ tone, icon, when, children, clamp = true }: { tone: Tone; icon: LucideIcon; when: ReactNode; children: ReactNode; clamp?: boolean }) {
  return (
    <div {...stylex.props(styles.feedItem)}>
      <FeedDot tone={tone} icon={icon} />
      <div {...stylex.props(styles.what, clamp && styles.whatClamp)}>{children}</div>
      <span {...stylex.props(styles.when)}>{when}</span>
    </div>
  );
}

/** An empty panel, with its Higgsfield still when one exists. Never pretends there is no data when the source is down: pass the reason. */
export function Empty({ slot, title, children }: { slot?: MotionSlot; title: ReactNode; children?: ReactNode }) {
  return (
    <div {...stylex.props(styles.empty)}>
      {slot && <MotionMedia slot={slot} contain fallback={<span {...stylex.props(styles.emptyArtFallback)} />} style={styles.emptyArt} />}
      <span {...stylex.props(styles.emptyTitle)}>{title}</span>
      {children && <span>{children}</span>}
    </div>
  );
}

export function Notice({ tone = 'error', title, hint, children }: { tone?: 'error' | 'warn' | 'ok'; title: ReactNode; hint?: string | undefined; children?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} {...stylex.props(styles.notice, animate.fadeInFast, tone === 'error' ? styles.noticeErr : tone === 'warn' ? styles.noticeWarn : styles.noticeOk)}>
      <Icon icon={CircleAlert} size={15} />
      <div>
        <span {...stylex.props(styles.noticeBody)}>{title}</span>
        {hint && <span {...stylex.props(styles.noticeHint)}>{hint}</span>}
        {children}
      </div>
    </div>
  );
}

/** Open as a modal, then move focus to the field marked data-autofocus (showModal would focus Close first). */
function openModal(node: HTMLDialogElement | null) {
  if (!node || node.open) return;
  node.showModal();
  node.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}

export function Dialog({ title, onClose, children, wide = false, splash, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; splash?: MotionSlot; icon?: ReactNode }) {
  const titleId = useId();
  return (
    <dialog ref={openModal} aria-labelledby={titleId} onClose={onClose} onCancel={onClose} {...stylex.props(styles.dialog, animate.rise, wide && styles.wide)}>
      {splash && <MotionMedia slot={splash} fallback={null} style={styles.splash} />}
      <header {...stylex.props(styles.dialogHead)}>
        {icon}
        <h2 id={titleId} {...stylex.props(styles.dialogTitle)}>{title}</h2>
        <span {...stylex.props(styles.push)} />
        <Button variant="ghost" size="sm" iconOnly icon={X} label="Close" onClick={onClose} />
      </header>
      <div {...stylex.props(styles.dialogBody)}>{children}</div>
    </dialog>
  );
}

export function KV({ rows }: { rows: readonly (readonly [ReactNode, ReactNode])[] }) {
  return (
    <dl {...stylex.props(styles.kv)}>
      {rows.map(([term, value], index) => <div key={index} {...stylex.props(styles.contents)}><dt {...stylex.props(styles.dt)}>{term}</dt><dd {...stylex.props(styles.dd)}>{value}</dd></div>)}
    </dl>
  );
}
