// A hash router read with useSyncExternalStore: the daemon serves one file, and
// the fragment keeps every screen linkable without server routes.
import { useSyncExternalStore } from 'react';

export type Screen = 'home' | 'projects' | 'linear' | 'agents' | 'models' | 'brain' | 'terminal' | 'settings';
export interface Route { screen: Screen; params: string[] }

const SCREENS: readonly Screen[] = ['home', 'projects', 'linear', 'agents', 'models', 'brain', 'terminal', 'settings'];

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const head = parts[0] as Screen | undefined;
  if (!head || !SCREENS.includes(head)) return { screen: 'home', params: [] };
  return { screen: head, params: parts.slice(1) };
}

let current = parse(window.location.hash);
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse(window.location.hash);
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function href(screen: Screen, ...params: string[]): string {
  return `#/${[screen, ...params].map(encodeURIComponent).join('/')}`;
}

export function navigate(screen: Screen, ...params: string[]): void {
  window.location.hash = href(screen, ...params).slice(1);
}
