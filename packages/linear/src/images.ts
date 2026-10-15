import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { HttpLinearClient, resolveLinearApiKey } from './client.js';
import { object, stableId, string } from './contract.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_SCREEN_ID_LENGTH = 128;
const MAX_CAPTION_LENGTH = 500;
const SCREEN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function readPng(file: string): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('Image must be a regular PNG file no larger than 20 MiB');
    const bytes = Buffer.alloc(stat.size + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const chunk = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    const png = bytes.subarray(0, bytesRead);
    if (png.length > MAX_IMAGE_BYTES || png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) === 0 || png.readUInt32BE(20) === 0) {
      throw new Error('Image must contain PNG bytes with a nonempty IHDR');
    }
    return png;
  } finally { await handle.close(); }
}

function assetUrl(value: unknown): string {
  const url = new URL(string(value));
  if (url.protocol !== 'https:' || url.hostname !== 'uploads.linear.app' || url.username || url.password) throw new Error('Linear returned an unsupported asset URL');
  return url.href;
}

async function transfer(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }); }
  catch { throw new Error('Linear image transfer failed; upstream details redacted'); }
}

function plainCaption(value: string): string {
  return value.replace(/[\\[\]`*_<>!]/g, ' ').replace(/\s+/g, ' ').trim();
}

function imageLines(description: string): { line: string; index: number }[] {
  let fence: string | undefined;
  return description.split(/\r?\n/).flatMap((line, index) => {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = undefined;
      return [];
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) { fence = opening[1]; return []; }
    return line.startsWith('![') ? [{ line, index }] : [];
  });
}

function hasImage(description: string, url: string, caption: string): boolean {
  const suffix = `](${url})`;
  return imageLines(description).some(({ line }) =>
    line.startsWith('![') && line.endsWith(suffix) && plainCaption(line.slice(2, -suffix.length)) === caption);
}

function isScreenImage(line: string, screen: string): boolean {
  const image = /^!\[([^\]\n]*)\]\([^\n)]*\)\s*$/.exec(line);
  return image?.[1] !== undefined && plainCaption(image[1]).startsWith(`screen:${screen} | `);
}

function replaceScreenImage(description: string, screen: string, image: string): string | undefined {
  let found = false;
  const matches = new Set(imageLines(description).filter(({ line }) => isScreenImage(line, screen)).map(({ index }) => index));
  const lines = description.split('\n').flatMap((line, index) => {
    if (!matches.has(index)) return [line];
    if (found) return [];
    found = true;
    return [image];
  });
  return found ? lines.join('\n') : undefined;
}

async function readImageIssue(client: HttpLinearClient, id: string) {
  let cursor: string | null = null;
  let issue: Record<string, unknown> = {};
  const attachments: { id: string; title: string; url: string }[] = [];
  const cursors = new Set<string>();
  do {
    const data = await client.query(`query KorImageIssue($id: String!, $after: String) {
      issue(id: $id) { id identifier description attachments(first: 100, after: $after) { nodes { id title url } pageInfo { hasNextPage endCursor } } }
    }`, { id, after: cursor });
    issue = object(data.issue);
    const page = object(issue.attachments);
    if (!Array.isArray(page.nodes)) throw new Error('Linear image attachment page is invalid');
    for (const value of page.nodes) {
      const attachment = object(value);
      attachments.push({ id: string(attachment.id), title: string(attachment.title), url: string(attachment.url) });
    }
    const info = object(page.pageInfo);
    if (typeof info.hasNextPage !== 'boolean') throw new Error('Linear image attachment pagination is invalid');
    cursor = info.hasNextPage ? string(info.endCursor) : null;
    if (cursor !== null && cursors.has(cursor)) throw new Error('Linear image attachment pagination repeated a cursor');
    if (cursor !== null) cursors.add(cursor);
  } while (cursor !== null);
  return {
    id: string(issue.id), identifier: string(issue.identifier),
    description: issue.description === null ? '' : string(issue.description), attachments,
  };
}

export async function attachLinearImage(input: { issue: string; file: string; alt: string; screen?: string }) {
  const png = await readPng(input.file);
  const alt = input.alt.trim();
  if (!alt || alt.length > MAX_CAPTION_LENGTH || /[\r\n\x00-\x1f]/.test(alt)) throw new Error('Image caption must be 1..500 characters on one line');
  const normalized = plainCaption(alt);
  if (!normalized) throw new Error('Image caption must contain visible text');
  const screen = input.screen;
  if (screen !== undefined && (screen.length > MAX_SCREEN_ID_LENGTH || !SCREEN_ID.test(screen))) throw new Error('Screen ID must be 1..128 lowercase letters, digits and single hyphens');
  const caption = screen ? `screen:${screen} | ${normalized}` : normalized;
  if (caption.length > MAX_CAPTION_LENGTH) throw new Error('Screen ID and image caption must fit within 500 characters');
  const apiKey = await resolveLinearApiKey();
  const client = new HttpLinearClient({ apiKey });
  const issue = await readImageIssue(client, input.issue);
  const digest = createHash('sha256').update(png).digest('hex');
  const attachmentId = stableId('kor-screen', `${issue.id}:${digest}:${caption}`);
  let url = issue.attachments.find(attachment => attachment.id === attachmentId)?.url;
  if (!url) {
    const data = await client.query(`mutation KorImageUpload($size: Int!, $name: String!) {
      fileUpload(contentType: "image/png", filename: $name, size: $size) {
        success uploadFile { uploadUrl assetUrl headers { key value } }
      }
    }`, { size: png.length, name: basename(input.file) });
    const payload = object(data.fileUpload);
    if (payload.success !== true) throw new Error('Linear image upload was not prepared');
    const upload = object(payload.uploadFile);
    url = assetUrl(upload.assetUrl);
    const uploadUrl = new URL(string(upload.uploadUrl));
    if (uploadUrl.protocol !== 'https:' || uploadUrl.username || uploadUrl.password) throw new Error('Linear returned an unsupported upload URL');
    const headers = new Headers({ 'content-type': 'image/png' });
    const returnedHeaders = upload.headers;
    if (!Array.isArray(returnedHeaders)) throw new Error('Linear upload headers are missing');
    for (const value of returnedHeaders) {
      const header = object(value);
      headers.set(string(header.key), string(header.value));
    }
    const response = await transfer(uploadUrl.href, { method: 'PUT', headers, body: new Uint8Array(png) });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Linear image upload failed: HTTP ${response.status}; upstream body redacted`);
    const attached = await client.query(`mutation KorImageAttachment($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) { success }
    }`, { input: { id: attachmentId, issueId: issue.id, title: caption, url } });
    if (object(attached.attachmentCreate).success !== true) throw new Error('Linear image attachment was not created');
  }
  url = assetUrl(url);
  const marker = `<!-- kor-screen:${attachmentId} -->`;
  const image = screen ? `![${caption}](${url})` : `${marker}\n![${caption}](${url})`;
  const latest = await readImageIssue(client, issue.id);
  const screenImages = screen ? imageLines(latest.description).filter(({ line }) => isScreenImage(line, screen)) : [];
  if (!hasImage(latest.description, url, caption) || screen && screenImages.length !== 1) {
    let description: string;
    const replacement = screen ? replaceScreenImage(latest.description, screen, image) : undefined;
    const markerPosition = screen ? -1 : latest.description.indexOf(marker);
    if (replacement !== undefined) {
      description = replacement;
    } else if (markerPosition >= 0) {
      const tailPosition = markerPosition + marker.length;
      const oldImage = /^\s*!\[[^\n]*?\]\([^\n)]*\)/.exec(latest.description.slice(tailPosition));
      if (!oldImage) throw new Error('Linear image marker has no image; inspect the issue before retrying');
      description = `${latest.description.slice(0, markerPosition)}${image}${latest.description.slice(tailPosition + oldImage[0].length)}`;
    } else {
      const screens = /^## Screens\s*$/m.exec(latest.description);
      const position = screens ? screens.index + screens[0].trimEnd().length : latest.description.length;
      description = screens
        ? `${latest.description.slice(0, position)}\n\n${image}\n${latest.description.slice(position)}`
        : `${latest.description.trimEnd()}\n\n## Screens\n\n${image}\n`;
    }
    const updated = await client.query(`mutation KorImageDescription($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`, { id: issue.id, input: { description } });
    if (object(updated.issueUpdate).success !== true) throw new Error('Linear image description was not saved; rerun the same command to resume');
  }
  const saved = await readImageIssue(client, issue.id);
  if (screen && imageLines(saved.description).filter(({ line }) => isScreenImage(line, screen)).length !== 1) throw new Error('Linear screen readback must contain exactly one image for the screen ID');
  if (!hasImage(saved.description, url, caption) || !saved.attachments.some(attachment => attachment.id === attachmentId && attachment.url === url && plainCaption(attachment.title) === caption)) {
    throw new Error('Linear image readback failed; inspect the issue before retrying');
  }
  const downloaded = await transfer(url, { headers: { authorization: apiKey } });
  if (!downloaded.ok) {
    await downloaded.body?.cancel();
    throw new Error(`Linear image readback failed: HTTP ${downloaded.status}; upstream body redacted`);
  }
  const reader = downloaded.body?.getReader();
  if (!reader) throw new Error('Linear image readback is empty');
  const hash = createHash('sha256');
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('Linear image readback exceeds size limit');
      hash.update(chunk.value);
    }
  } finally { await reader.cancel(); }
  if (size !== png.length || hash.digest('hex') !== digest) throw new Error('Linear image bytes did not match the uploaded PNG');
  return { schemaVersion: 1, issue: saved.identifier, attachmentId, ...(screen ? { screen } : {}), bytes: size, sha256: digest, verified: true };
}
