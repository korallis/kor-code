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
// Anchor keys to a run boundary so a long word run is scanned once, and only
// consume an assignment value after identifying a credential key. Leaving
// non-credential values unconsumed lets nested credentials in URLs and logs be
// found on the next scan.
const assignmentKey = /(?<![A-Za-z0-9_.-])(["']?)([A-Za-z0-9_.-]+)\1\s*[:=]\s*["']?/g;
const assignmentValue = /[^\s,;"'}]+/y;
function redactAssignments(text: string): string {
  let output = "";
  let last = 0;
  assignmentKey.lastIndex = 0;
  for (let match = assignmentKey.exec(text); match; match = assignmentKey.exec(text)) {
    if (!isCredentialKey(match[2]!)) continue;
    const valueStart = match.index + match[0].length;
    assignmentValue.lastIndex = valueStart;
    const value = assignmentValue.exec(text);
    if (!value) continue;
    output += text.slice(last, valueStart) + "[redacted]";
    last = valueStart + value[0].length;
    assignmentKey.lastIndex = last;
  }
  return output + text.slice(last);
}
export function redact(value: unknown, secrets: readonly string[] = runtimeSecrets()): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) if (secret) text = text.split(secret).join("[redacted]");
    return redactAssignments(text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]"));
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, isCredentialKey(name) ? "[redacted]" : redact(item, secrets)]));
  return value;
}
