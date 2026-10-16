import type { LiveResource } from "@kor-code/mission-control";
import type { MissionEvents } from "./events.js";

/** Observation times change on every read, without changing the displayed value. */
export function stateSignature(value: unknown): string {
  return JSON.stringify(value, (key, value: unknown) => key === "observedAt" ? undefined : value);
}

interface Observation {
  resource: LiveResource;
  read: () => Promise<unknown>;
  interval: () => number;
  value: Promise<unknown>;
  signature: string | undefined;
  startedAt: number;
  pending: boolean;
}
const MAX_OBSERVATIONS = 256;

/** External reads are cached across tabs; only the daemon's cadence refreshes them. */
export class MissionObservations {
  private readonly reads = new Map<string, Observation>();
  private closed = false;
  constructor(private readonly events: MissionEvents, private readonly cadence: () => number) {}

  read<T>(key: string, resource: LiveResource, read: () => Promise<T>, interval?: number): Promise<T> {
    let entry = this.reads.get(key);
    if (!entry) {
      if (this.reads.size >= MAX_OBSERVATIONS) {
        const oldest = this.reads.keys().next().value;
        if (oldest !== undefined) this.reads.delete(oldest);
      }
      entry = { resource, read, interval: interval === undefined ? this.cadence : () => interval, value: Promise.resolve(undefined), signature: undefined, startedAt: 0, pending: false };
      this.reads.set(key, entry);
      this.observe(key, entry);
    }
    // Each canonical endpoint key has one response type.
    return entry.value as Promise<T>;
  }

  private observe(key: string, entry: Observation): void {
    entry.startedAt = Date.now();
    entry.pending = true;
    entry.value = Promise.resolve().then(entry.read).then(value => {
      const signature = stateSignature(value);
      const changed = entry.signature !== undefined && entry.signature !== signature;
      entry.signature = signature;
      if (!this.closed && this.reads.get(key) === entry && changed) this.events.publish({ kind: "invalidate", resources: [entry.resource] });
      return value;
    }).finally(() => { entry.pending = false; });
    void entry.value.catch(() => undefined);
  }

  refresh(): void {
    if (this.closed || !this.events.connected) return;
    for (const [key, entry] of this.reads) {
      if (!entry.pending && Date.now() - entry.startedAt >= entry.interval()) this.observe(key, entry);
    }
  }

  clear(resource?: LiveResource): void {
    for (const [key, entry] of this.reads) if (resource === undefined || entry.resource === resource) this.reads.delete(key);
  }

  close(): void { this.closed = true; this.reads.clear(); }
}
