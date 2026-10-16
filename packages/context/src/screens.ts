import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { ContextSource } from "@kor-code/core";

const MAX_SCREENS = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"], ["image/gif", ".gif"]]);
const PRIVATE_ADDRESSES = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 3]] satisfies [string, number][]) PRIVATE_ADDRESSES.addSubnet(address, prefix);
for (const [address, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] satisfies [string, number][]) PRIVATE_ADDRESSES.addSubnet(address, prefix, "ipv6");

export interface TicketImage { title: string; url: string }

export function ticketImages(markdown: readonly string[], resources: readonly TicketImage[] = []): TicketImage[] {
  const images = markdown.flatMap(text => [...text.matchAll(/!\[([^\]]*)\]\(\s*<?(https:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g)]
    .flatMap(match => match[2] ? [{ title: match[1] || "Ticket screenshot", url: match[2] }] : []));
  images.push(...resources.filter(item => /\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(item.url)));
  return [...new Map(images.map(image => [image.url, image])).values()].slice(0, 40);
}

async function screenDirectory(root: string, issue: string): Promise<string> {
  let directory = root;
  for (const segment of [".kor", "context", issue.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80), "screens"]) {
    directory = join(directory, segment || "issue");
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
    directory = await realpath(directory);
    const path = relative(root, directory);
    if (path === ".." || path.startsWith(`..${sep}`) || path.startsWith(sep)) throw new Error("Image directory escapes the worktree");
  }
  const ignore = join(root, ".kor", "context", ".gitignore");
  await writeFile(ignore, "*\n", { flag: "wx", mode: 0o600 }).catch(error => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
  return directory;
}

async function imageBytes(response: Response): Promise<{ bytes: Buffer; extension: string }> {
  const extension = IMAGE_EXTENSIONS.get(response.headers.get("content-type")?.split(";")[0]?.trim() ?? "");
  if (!response.ok || !extension || !response.body) {
    await response.body?.cancel();
    throw new Error("Image response is unavailable or unsupported");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds size limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (size === 0) throw new Error("Image is empty");
  return { bytes: Buffer.concat(chunks), extension };
}

export async function downloadScreens(sources: readonly ContextSource[], options: { root: string; issue: string; images: readonly TicketImage[]; fetchImage?: (url: string) => Promise<Response> }): Promise<ContextSource[]> {
  let selected = 0;
  const result: ContextSource[] = [];
  for (const source of sources) {
    if (source.purpose !== "image") { result.push(source); continue; }
    if (selected >= MAX_SCREENS) continue;
    selected += 1;
    const image = options.images[Number(source.id.slice("image:".length))];
    if (!image) continue;
    try {
      const url = new URL(image.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Unsupported image URL");
      const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
      if (addresses.length === 0 || addresses.some(item => PRIVATE_ADDRESSES.check(item.address, isIP(item.address) === 6 ? "ipv6" : "ipv4"))) throw new Error("Image URL must resolve to a public address");
      const response = options.fetchImage
        ? await options.fetchImage(url.href)
        : await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      const { bytes, extension } = await imageBytes(response);
      const directory = await screenDirectory(options.root, options.issue);
      const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}-${randomUUID()}${extension}`;
      const path = join(directory, name);
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      result.push({ ...source, path: relative(options.root, path), content: source.content });
    } catch {
      result.push({ ...source, path: "ticket", content: "Screenshot unavailable; attach a PNG, JPEG, WebP or GIF (maximum 5 MiB) through a direct HTTPS image URL." });
    }
  }
  return result;
}
