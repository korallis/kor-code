export function runtimeSecrets(): string[] {
  return Object.entries(process.env).filter(([name]) => /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(name)).flatMap(([, value]) => value ? [value] : []);
}
function isCredentialKey(name: string): boolean {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").split(/[^A-Za-z0-9]+/).filter(Boolean).map(word => word.toLowerCase());
  const last = words.at(-1);
  if (!last) return false;
  if (["token", "secret", "password", "authorization", "credential", "credentials", "jwt"].includes(last)) return true;
  if (last === "key" && words.slice(0, -1).some(word => ["api", "private", "secret"].includes(word))) return true;
  return ["apikey", "accesstoken", "refreshtoken", "clientsecret"].includes(words.join(""));
}
const credentialAssignment = /((["']?)([A-Za-z0-9_.-]+)\2\s*[:=]\s*["']?)([^\s,;"'}]+)/g;
export function redact(value: unknown, secrets: readonly string[] = runtimeSecrets()): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) if (secret) text = text.split(secret).join("[redacted]");
    return text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").replace(credentialAssignment, (match, prefix: string, _quote: string, key: string) => isCredentialKey(key) ? `${prefix}[redacted]` : match);
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, isCredentialKey(name) ? "[redacted]" : redact(item, secrets)]));
  return value;
}
