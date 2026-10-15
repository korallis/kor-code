import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { HttpLinearClient, resolveLinearApiKey } from './client.js';
import { connection, object, stableId, string } from './contract.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const REQUEST_TIMEOUT_MS = 30_000;

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

function hasImage(description: string, url: string, caption: string): boolean {
  const suffix = `](${url})`;
  return description.split(/\r?\n/).some(line =>
    line.startsWith('![') && line.endsWith(suffix) && plainCaption(line.slice(2, -suffix.length)) === caption);
}

async function readImageIssue(client: HttpLinearClient, id: string) {
  const data = await client.query(`query KorImageIssue($id: String!) {
    issue(id: $id) { id identifier description attachments(first: 100) { nodes { id title url } pageInfo { hasNextPage } } }
  }`, { id });
  const issue = object(data.issue);
  return {
    id: string(issue.id), identifier: string(issue.identifier),
    description: issue.description === null ? '' : string(issue.description),
    attachments: connection(issue.attachments).map(value => {
      const attachment = object(value);
      return { id: string(attachment.id), title: string(attachment.title), url: string(attachment.url) };
    }),
  };
}

export async function attachLinearImage(input: { issue: string; file: string; alt: string }) {
  const png = await readPng(input.file);
  const alt = input.alt.trim();
  if (!alt || alt.length > 500 || /[\r\n\x00-\x1f]/.test(alt)) throw new Error('Image caption must be 1..500 characters on one line');
  const caption = plainCaption(alt);
  if (!caption) throw new Error('Image caption must contain visible text');
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
  const image = `${marker}\n![${caption}](${url})`;
  const latest = await readImageIssue(client, issue.id);
  if (!hasImage(latest.description, url, caption)) {
    let description: string;
    const markerPosition = latest.description.indexOf(marker);
    if (markerPosition >= 0) {
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
  return { schemaVersion: 1, issue: saved.identifier, attachmentId, bytes: size, sha256: digest, verified: true };
}
