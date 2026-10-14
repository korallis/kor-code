// A shared clock read with useSyncExternalStore: one interval for the whole app,
// started by the first reader and stopped by the last.
import { useSyncExternalStore } from 'react';

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) timer = setInterval(() => { now = Date.now(); for (const l of listeners) l(); }, 1_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) { clearInterval(timer); timer = null; }
  };
}

/** The current time, refreshed every second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now, () => now);
}

export function ago(iso: string | undefined | null, at: number): string {
  if (!iso) return '—';
  const ms = at - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const clock = (at: number | string) => clockFormat.format(typeof at === 'string' ? Date.parse(at) : at);
export const day = (at: number) => dayFormat.format(at);
export const longDate = (at: number) => longDay.format(at);
export const shortDate = (at: number | string) => shortDay.format(typeof at === 'string' ? Date.parse(at) : at);

export function greeting(at: number): string {
  const hour = new Date(at).getHours();
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function isToday(iso: string | undefined, at: number): boolean {
  if (!iso) return false;
  const a = new Date(Date.parse(iso)), b = new Date(at);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Until a reset time, as "3h 36m". */
export function until(iso: string | undefined, at: number): string {
  if (!iso) return '—';
  return duration(Date.parse(iso) - at);
}
