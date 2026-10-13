export function runtimeSecrets(): string[] {
  return Object.entries(process.env).filter(([name]) => /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(name)).flatMap(([, value]) => value ? [value] : []);
}
export function redact(value: unknown, secrets: readonly string[] = runtimeSecrets()): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) if (secret) text = text.split(secret).join("[redacted]");
    return text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").replace(/((?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1[redacted]");
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, /(?:api[_-]?key|authorization|token|password|secret)/i.test(name) ? "[redacted]" : redact(item, secrets)]));
  return value;
}
