#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// gh-axi formats JSON as TOON. Base64 keeps the API payload lossless in one scalar.
function api(method, path, data) {
  const args = ['api', method, path, '--jq', '@base64', '--full'];
  if (data !== undefined) args.push('--input', '-');
  const result = spawnSync('gh-axi', args, {
    input: data === undefined ? undefined : JSON.stringify(data),
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const envelope = /^  body: (.+)$/m.exec(result.stdout);
  if (!envelope) throw new Error('Expected gh-axi API envelope; check installed gh-axi version.');
  const encoded = envelope[1].startsWith('"') ? JSON.parse(envelope[1]) : envelope[1];
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function imageFromRecord(record) {
  if (record.type !== 'file' || record.encoding !== 'base64' || typeof record.content !== 'string') {
    throw new Error('Expected a repository file with base64 contents (PNG limit 1 MiB).');
  }
  return Buffer.from(record.content, 'base64');
}
function attach(body, id, image) {
  const lines = body.split('\n');
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const result = [];
  let fence;
  let replaced = false;
  for (const line of lines) {
    const carriageReturn = line.endsWith('\r') ? '\r' : '';
    const content = carriageReturn ? line.slice(0, -1) : line;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) {
      fence = fence ? undefined : marker;
    }
    if (!fence && content.startsWith(`![screen:${id} | `) && /^!\[[^\]\r\n]+\]\([^\r\n]+\)$/.test(content)) {
      if (!replaced) result.push(image + carriageReturn);
      replaced = true;
    } else result.push(line);
  }
  if (replaced) return result.join('\n');
  // Insert in the actual Screens section, leaving fenced examples alone.
  fence = undefined;
  let screens = -1;
  let end = result.length;
  for (let index = 0; index < result.length; index++) {
    const line = result[index];
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) fence = fence ? undefined : marker;
    if (fence) continue;
    if (/^## Screens\s*$/.test(line)) screens = index;
    else if (screens !== -1 && /^#{1,2} /.test(line)) { end = index; break; }
  }
  if (screens === -1) return [body.trimEnd(), '', '## Screens', '', image, ''].join(newline);
  const carriageReturn = newline === '\r\n' ? '\r' : '';
  result.splice(end, 0, image + carriageReturn, carriageReturn);
  return result.join('\n');
}

async function main() {
  const [issue, file, ...flags] = process.argv.slice(2);
  const usage = 'node attach-github-image.mjs OWNER/REPO#NUMBER FILE --ref COMMIT-SHA --path REPO-PNG --screen ID --alt CAPTION';
  const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(issue ?? '');
  if (!match || !file || flags.length !== 8) throw new Error(usage);
  const values = new Map();
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i];
    if (!['--ref', '--path', '--screen', '--alt'].includes(key) || values.has(key) || !flags[i + 1]) throw new Error(usage);
    values.set(key, flags[i + 1]);
  }
  const ref = values.get('--ref'), path = values.get('--path'), id = values.get('--screen'), alt = values.get('--alt');
  if (!/^[a-f0-9]{40}$/.test(ref) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 128) throw new Error('Use a full commit SHA and stable lowercase screen ID.');
  if (!path.endsWith('.png') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Use a repository-relative PNG path.');
  if (/[\[\]\r\n\\]/.test(alt) || `screen:${id} | ${alt}`.length > 500) throw new Error('Caption must be one line, at most 500 characters with ID, without brackets or backslashes.');
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Use an actual PNG no larger than 1 MiB.');
  const repo = match[1];
  const contents = `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`;
  if (!imageFromRecord(api('GET', contents)).equals(bytes)) throw new Error('Committed PNG differs from local image; publish and inspect the intended revision first.');
  const url = `https://github.com/${repo}/blob/${ref}/${path.split('/').map(encodeURIComponent).join('/')}?raw=true`;
  const image = `![screen:${id} | ${alt}](${url})`;
  const endpoint = `/repos/${repo}/issues/${match[2]}`;
  const before = api('GET', endpoint);
  if (before.pull_request || typeof before.body !== 'string' && before.body !== null) throw new Error('Expected an issue body.');
  const previous = before.body ?? '';
  const body = attach(previous, id, image);
  if (body !== previous) {
    if ((api('GET', endpoint).body ?? '') !== previous) throw new Error('Issue changed during attachment; reread and retry.');
    api('PATCH', endpoint, { body });
  }
  const saved = api('GET', endpoint);
  if (saved.body !== body || attach(saved.body, id, image) !== saved.body) throw new Error('Issue image readback differs; inspect before retrying.');
  if (!imageFromRecord(api('GET', contents)).equals(bytes)) throw new Error('Stored image verification failed.');
  process.stdout.write(`${JSON.stringify({ issue: saved.html_url, screen: id, url, sha256: hash(bytes), bytes: bytes.length, verified: true, changed: body !== previous })}\n`);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
