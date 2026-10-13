export type SessionEventKind = "stdout" | "stderr" | "json" | "started" | "exited" | "error";
export interface SessionEvent { at: string; kind: SessionEventKind; text?: string; value?: unknown }
export class EventCollector {
  readonly events: SessionEvent[] = [];
  add(kind: SessionEventKind, value?: unknown): void { this.events.push({ at: new Date().toISOString(), kind, ...(typeof value === "string" ? { text: value } : value === undefined ? {} : { value }) }); }
  line(kind: "stdout" | "stderr", line: string): void { const trimmed = line.trim(); if (!trimmed) return; try { this.add("json", JSON.parse(trimmed)); } catch { this.add(kind, line); } }
}
