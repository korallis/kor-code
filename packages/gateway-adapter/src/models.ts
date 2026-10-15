/** Route prefixes belong to the gateway; keep the original id for requests. */
export function modelFamily(id: string): string {
  const name = (id.split("/").at(-1) ?? id).toLowerCase()
    .replace(/^model_(?:chat_|google_)?/, "");
  return name.split(/[-_.]/)[0] || "unknown";
}

export function modelProvider(id: string, owner?: string): string {
  if (owner) return owner;
  switch (modelFamily(id)) {
    case "claude": return "anthropic";
    case "gpt": case "codex": return "openai";
    case "grok": return "xai";
    case "kimi": return "moonshot";
    case "gemini": return "google";
    case "deepseek": return "deepseek";
    case "glm": return "zhipu";
    case "swe": return "cognition";
    case "nemotron": return "nvidia";
    case "inkling": return "devin";
    default: return "unknown";
  }
}

export function isTextModel(id: string): boolean {
  const name = (id.split("/").at(-1) ?? id).toLowerCase();
  return !/^(?:gpt-image(?:-|$)|grok-(?:imagine|tts|voice)(?:-|$))/.test(name);
}
