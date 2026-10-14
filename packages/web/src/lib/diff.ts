export interface DiffLine { kind: 'add' | 'del' | 'ctx' | 'hunk'; oldNo: number | null; newNo: number | null; text: string }
export interface DiffFile { path: string; added: number; removed: number; lines: DiffLine[] }

/** Parse a unified diff (git diff) into files and numbered lines. */
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldNo = 0, newNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const match = / b\/(.+)$/.exec(raw);
      file = { path: match?.[1] ?? raw.slice(11), added: 0, removed: 0, lines: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('+++ ')) { const p = raw.slice(4).replace(/^b\//, ''); if (p !== '/dev/null') file.path = p; continue; }
    if (raw.startsWith('--- ') || raw.startsWith('index ') || raw.startsWith('new file') || raw.startsWith('deleted file') || raw.startsWith('similarity') || raw.startsWith('rename ')) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) { oldNo = Number(hunk[1]); newNo = Number(hunk[2]); file.lines.push({ kind: 'hunk', oldNo: null, newNo: null, text: raw }); continue; }
    if (raw.startsWith('+')) { file.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: raw.slice(1) }); file.added++; continue; }
    if (raw.startsWith('-')) { file.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: raw.slice(1) }); file.removed++; continue; }
    if (raw.startsWith(' ')) file.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: raw.slice(1) });
  }
  return files;
}
