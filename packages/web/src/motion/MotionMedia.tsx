// Plays a Higgsfield slot over its coded fallback. Glows composite with
// mix-blend-mode: screen, so the navy background drops out. Under reduced
// motion the poster shows instead; off-screen loops pause.
import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode } from 'react';
import { animate } from '../theme/animate';
import { useMotionAsset, useReducedMotion, type MotionSlot } from './assets';

const styles = stylex.create({
  wrap: { position: 'relative', display: 'block' },
  media: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', mixBlendMode: 'screen', pointerEvents: 'none' },
  contain: { objectFit: 'contain' },
  round: { borderRadius: '50%' },
});

/** Pause a looping video while it is off-screen. A ref callback, so no effect is needed. */
function pauseOffscreen(video: HTMLVideoElement | null): (() => void) | undefined {
  if (!video || typeof IntersectionObserver === 'undefined') return undefined;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    }
  });
  observer.observe(video);
  return () => observer.disconnect();
}

export function MotionMedia({ slot, fallback, contain = false, round = false, once = false, label, style, playKey }: {
  slot: MotionSlot; fallback: ReactNode; contain?: boolean; round?: boolean; once?: boolean; label?: string; style?: stylex.StyleXStyles; playKey?: string | number;
}) {
  const asset = useMotionAsset(slot);
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState<string | null>(null);
  const mediaStyle = stylex.props(styles.media, animate.fadeIn, contain && styles.contain, round && styles.round);
  let media: ReactNode = null;
  if (asset && failed !== slot) {
    const still = asset.poster ?? (asset.kind === 'image' ? asset.sources[0]?.src : undefined);
    if (reduced && asset.posterWhenReduced) {
      if (still && !once) media = <img src={still} alt="" aria-hidden="true" {...mediaStyle} onError={() => setFailed(slot)} />;
    } else if (asset.kind === 'video') {
      media = (
        <video key={playKey} autoPlay muted playsInline loop={!once && asset.loop} poster={asset.poster} aria-hidden="true" ref={once || !asset.loop ? undefined : pauseOffscreen} {...mediaStyle} onError={() => setFailed(slot)}>
          {asset.sources.map(source => <source key={source.src} src={source.src} type={source.type} />)}
        </video>
      );
    } else {
      media = <img src={asset.sources[0]!.src} alt="" aria-hidden="true" {...mediaStyle} onError={() => setFailed(slot)} />;
    }
  }
  return (
    <span aria-label={label} {...stylex.props(styles.wrap, style)}>
      {(!media || once) && fallback}
      {media}
    </span>
  );
}
