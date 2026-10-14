import type { Tone } from '../ui/text';
const TONES: readonly Tone[] = ['violet', 'cyan', 'sky', 'green', 'magenta', 'amber', 'orange'];
/** A stable tone per project, by its position in the configured repository list. */
export function projectTone(index: number): Tone { return TONES[index % TONES.length]!; }
/** "Matilda v2" → "M2", "HC-Prime" → "HC", "kor-code" → "KC". */
export function initials(name: string): string {
  const parts = name.replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  const last = parts.at(-1)!;
  const tail = /^v?\d+$/i.test(last) ? last.replace(/^v/i, '') : last[0]!;
  return `${parts[0]![0]!}${tail}`.toUpperCase().slice(0, 2);
}
