// Higgsfield motion slots. The asset set lives in public/motion/ with a
// manifest.json naming each slot (kind, ordered sources, posters, loop,
// reduced-motion rule). Every slot has a coded fallback, so the app looks
// complete before, or without, the assets.
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

export interface MotionSource { src: string; type?: string | undefined }
export interface MotionAsset { kind: 'video' | 'animated-image' | 'image'; sources: MotionSource[]; poster?: string | undefined; loop: boolean; posterWhenReduced: boolean }

const obj = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

function files(value: unknown, base: string): MotionSource[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.flatMap(item => {
    const entry = obj(item);
    const src = typeof item === 'string' ? item : typeof entry?.src === 'string' ? entry.src : null;
    if (!src) return [];
    return [{ src: /^(\/|https?:)/.test(src) ? src : `${base}${src}`, type: typeof entry?.type === 'string' ? entry.type : undefined }];
  });
}

function readManifest(raw: unknown): Partial<Record<MotionSlot, MotionAsset>> {
  const root = obj(raw);
  const base = typeof root?.basePath === 'string' ? root.basePath : '/motion/';
  const slots = obj(root?.slots) ?? {};
  const out: Partial<Record<MotionSlot, MotionAsset>> = {};
  for (const [name, value] of Object.entries(slots)) {
    const entry = obj(value);
    if (!entry) continue;
    const sources = files(entry.sources ?? entry.src, base);
    if (sources.length === 0) continue;
    const kind = entry.kind === 'video' || entry.kind === 'animated-image' ? entry.kind : 'image';
    out[name as MotionSlot] = { kind, sources, poster: files(entry.poster, base)[0]?.src, loop: entry.loop !== false, posterWhenReduced: entry.reducedMotion !== 'same' };
  }
  return out;
}

export function useMotionAsset(slot: MotionSlot): MotionAsset | null {
  const { data } = useQuery({
    queryKey: ['motion-manifest'], staleTime: Infinity, retry: false,
    queryFn: async () => {
      const response = await fetch('/motion/manifest.json', { cache: 'no-cache' });
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
