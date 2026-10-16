import type { TrackerIssue } from './contract.js';

const imageExtension = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|heic)$/i;

function imageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && imageExtension.test(url.pathname);
  } catch { return false; }
}

function markdownHasImage(markdown: string): boolean {
  const text = markdown.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/`[^`\n]*`/g, '');
  if (/!\[[^\]\n]*\]\(\s*<?(?:https?:\/\/|data:image\/)[^\s)]+/i.test(text)) return true;
  if (/<img\b[^>]*\bsrc\s*=\s*["'](?:https?:\/\/|data:image\/)[^"']+["'][^>]*>/i.test(text)) return true;
  const references = new Set([...text.matchAll(/^\s{0,3}\[([^\]\n]+)\]:\s*<?(?:https?:\/\/|data:image\/)[^\s>]+/gim)].map(match => match[1]!.trim().toLowerCase()));
  return [...text.matchAll(/!\[([^\]\n]*)\](?:\[([^\]\n]*)\])?/g)].some(match => references.has((match[2] || match[1]!).trim().toLowerCase()));
}

export function hasScreenshot(issue: Pick<TrackerIssue, 'description' | 'comments' | 'resources'>): boolean {
  return markdownHasImage(issue.description ?? '')
    || issue.comments.some(comment => markdownHasImage(comment.body))
    || issue.resources.some(resource => imageUrl(resource.url));
}
