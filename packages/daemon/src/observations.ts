import type { LiveResource } from "@kor-code/mission-control";
import type { MissionEvents } from "./events.js";

/** Observation times change on every read, without changing the displayed value. */
export function stateSignature(value: unknown): string {
  return JSON.stringify(value, (key, value: unknown) => key === "observedAt" ? undefined : value);
}

/** Watch reads shared by all tabs; publish only when their source changes. */
export class MissionObservations {
  private readonly reads = new Map<string, { refresh: () => Promise<void>; pending: Promise<void> | null }>();
  private readonly signatures = new Map<string, string>();
  constructor(private readonly events: MissionEvents) {}

  async read<T>(key: string, resource: LiveResource, read: () => Promise<T>): Promise<T> {
    const observe = async () => {
      const value = await read();
      const signature = stateSignature(value);
      const previous = this.signatures.get(key);
      this.signatures.set(key, signature);
      if (previous !== undefined && previous !== signature) this.events.publish({ kind: "invalidate", resources: [resource] });
      return value;
    };
    const refresh = async () => { await observe(); };
    const entry = this.reads.get(key);
    if (entry) entry.refresh = refresh;
    else this.reads.set(key, { refresh, pending: null });
    return observe();
  }

  refresh(): void {
    if (!this.events.connected) return;
    for (const entry of this.reads.values()) {
      if (entry.pending) continue;
      entry.pending = entry.refresh().catch(() => undefined).finally(() => { entry.pending = null; });
    }
  }

  async close(): Promise<void> { await Promise.all([...this.reads.values()].map(entry => entry.pending)); }
}
