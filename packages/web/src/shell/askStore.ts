// The Ask Jev panel and keyboard shortcuts, held outside React: ⌘K / Ctrl+K
// opens Ask Jev from anywhere, Ctrl+` opens the live terminal.
import { useSyncExternalStore } from 'react';
import { navigate } from '../router';

interface AskState { open: boolean; executionId: string | undefined; prompt: string }
let state: AskState = { open: false, executionId: undefined, prompt: '' };
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

export function openAsk(options: { executionId?: string; prompt?: string } = {}): void {
  state = { open: true, executionId: options.executionId, prompt: options.prompt ?? '' };
  emit();
}
export function closeAsk(): void { state = { ...state, open: false }; emit(); }

window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (state.open) closeAsk(); else openAsk(); }
  else if (event.ctrlKey && event.key === '`') { event.preventDefault(); navigate('terminal'); }
});

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useAskState(): AskState { return useSyncExternalStore(subscribe, () => state, () => state); }
