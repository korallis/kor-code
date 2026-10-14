// A run's terminal: the transcript fetched once, then every streamed chunk
// past its offset. Session output offsets are byte ends; daemon log lines
// (offset 0) are spliced in only at line boundaries so they never break a
// stream-json line that arrived in pieces.
import { useLive } from './live';
import { useTerminal } from './queries';

const NONE: never[] = [];

export function useRunTerminal(executionId: string | undefined): { text: string; loading: boolean; error: Error | null } {
  const initial = useTerminal(executionId);
  const chunks = useLive(live => (executionId ? live.terminals[executionId] : undefined) ?? NONE);
  let text = initial.data?.content ?? '';
  const offset = initial.data?.offset ?? 0;
  let pending = '';
  for (const chunk of chunks) {
    if (chunk.channel === 'daemon') {
      if (text === '' || text.endsWith('\n')) text += chunk.text; else pending += chunk.text;
      continue;
    }
    if (chunk.offset <= offset) continue;
    text += chunk.text;
    if (pending && text.endsWith('\n')) { text += pending; pending = ''; }
  }
  if (pending) text += `\n${pending}`;
  return { text, loading: initial.isPending && executionId !== undefined, error: initial.error };
}
