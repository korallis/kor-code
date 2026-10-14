// Higgsfield motion slots. The asset set lives in public/motion/ with a
// manifest.json naming each slot; every slot has a coded fallback, so the app
// looks complete before (or without) the assets.
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

export type MotionSlot =
  | 'jev-orb-idle' | 'jev-orb-thinking' | 'jev-orb-deciding'
  | 'hero-background'
  | 'agent-avatar-generalist' | 'agent-avatar-specialist' | 'agent-avatar-reviewer' | 'agent-avatar-jev'
  | 'needs-you-ember'
  | 'pr-shipped'
  | 'empty-no-runs' | 'empty-no-issues' | 'empty-pool-unavailable' | 'empty-daemon-offline'
  | 'connect-splash';

export interface MotionAsset { webm?: string; mp4?: string; webp?: string; poster?: string; loop: boolean }

const BASE = '/motion/';
const url = (file: unknown) => typeof file === 'string' && file.length > 0 ? (/^(\/|https?:)/.test(file) ? file : `${BASE}${file}`) : undefined;

function readEntry(value: unknown): MotionAsset | null {
  if (typeof value === 'string') {
    const file = url(value);
    if (!file) return null;
    return /\.webm$/i.test(file) ? { webm: file, loop: true } : /\.mp4$/i.test(file) ? { mp4: file, loop: true } : /\.(webp|gif|png|avif)$/i.test(file) ? { webp: file, loop: true } : null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  const files: Record<string, unknown> = { ...entry, ...(typeof entry.files === 'object' && entry.files !== null ? entry.files as Record<string, unknown> : {}) };
  const pick = (pattern: RegExp) => {
    for (const [key, file] of Object.entries(files)) if (pattern.test(key) && url(file)) return url(file);
    for (const file of Object.values(files)) if (typeof file === 'string' && pattern.test(file)) return url(file);
    return undefined;
  };
  const asset: MotionAsset = { loop: entry.loop !== false && entry.oneShot !== true && entry.kind !== 'one-shot' };
  const webm = pick(/webm/i), mp4 = pick(/mp4|h264/i), webp = pick(/webp|animated/i), poster = pick(/poster|avif|still/i);
  if (webm) asset.webm = webm;
  if (mp4) asset.mp4 = mp4;
  if (webp) asset.webp = webp;
  if (poster) asset.poster = poster;
  return asset.webm || asset.mp4 || asset.webp || asset.poster ? asset : null;
}

function readManifest(raw: unknown): Partial<Record<MotionSlot, MotionAsset>> {
  const out: Partial<Record<MotionSlot, MotionAsset>> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const root = raw as Record<string, unknown>;
  const slots = root.slots ?? root.assets ?? root;
  if (Array.isArray(slots)) {
    for (const item of slots) {
      const slot = (item as Record<string, unknown>)?.slot ?? (item as Record<string, unknown>)?.name ?? (item as Record<string, unknown>)?.id;
      const asset = readEntry(item);
      if (typeof slot === 'string' && asset) out[slot as MotionSlot] = asset;
    }
  } else if (typeof slots === 'object' && slots !== null) {
    for (const [slot, item] of Object.entries(slots)) {
      const asset = readEntry(item);
      if (asset) out[slot as MotionSlot] = asset;
    }
  }
  return out;
}

export function useMotionAsset(slot: MotionSlot): MotionAsset | null {
  const { data } = useQuery({
    queryKey: ['motion-manifest'], staleTime: Infinity, retry: false,
    queryFn: async () => {
      const response = await fetch(`${BASE}manifest.json`, { cache: 'force-cache' });
      if (!response.ok) return {};
      return readManifest(await response.json());
    },
  });
  return data?.[slot] ?? null;
}

const reducedQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
function subscribeReduced(listener: () => void): () => void {
  reducedQuery?.addEventListener('change', listener);
  return () => reducedQuery?.removeEventListener('change', listener);
}
/** prefers-reduced-motion, live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => reducedQuery?.matches ?? false, () => false);
}
