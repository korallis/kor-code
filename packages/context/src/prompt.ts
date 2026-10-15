import type { ContextManifest, ContextSource } from "@kor-code/core";
import { redact } from "@kor-code/jev";

// A byte cap also bounds byte-tokenized text without a provider-specific tokenizer.
const MAX_CONTEXT_BYTES = 2_000;
const MAX_EXCERPT_BYTES = 600;
const GUIDANCE_BYTES = 800;
const FILE_HINT_BYTES = 400;
const SCREEN_HINT_BYTES = 800;

function truncate(value: string, bytes: number): string {
  let result = "";
  let remaining = bytes;
  for (const character of value) {
    remaining -= Buffer.byteLength(character);
    if (remaining < 0) break;
    result += character;
  }
  return result;
}

function section(title: string, sources: readonly ContextSource[], bytes: number): string {
  if (sources.length === 0) return "";
  const heading = `\n\n${title}\n`;
  const entries = sources.map(source => {
    if (source.purpose === "file") return source.path;
    if (source.purpose === "image") return source.path === "ticket" ? source.content : source.path;
    return `[${source.path}]\n${truncate(source.content, MAX_EXCERPT_BYTES)}`;
  }).join("\n\n");
  return heading + truncate(String(redact(entries)), bytes - Buffer.byteLength(heading));
}

export function contextPrompt(manifest: ContextManifest): string {
  const rules = manifest.sources.filter(source => source.purpose !== "file" && source.purpose !== "image" && source.purpose !== "issue");
  const files = manifest.sources.filter(source => source.purpose === "file").slice(0, 5);
  const images = manifest.sources.filter(source => source.purpose === "image").slice(0, 3);
  const prompt = section("Selected repository guidance (ranked excerpts):", rules, GUIDANCE_BYTES)
    + section("Suggested files (ranked hints):", files, FILE_HINT_BYTES)
    + section("Ticket screens (use Read to view):", images, SCREEN_HINT_BYTES);
  return truncate(prompt, MAX_CONTEXT_BYTES);
}
