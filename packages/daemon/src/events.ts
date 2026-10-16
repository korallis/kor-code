import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { EventPayload, MissionEvent } from "@kor-code/mission-control";
import { redact } from "@kor-code/jev";

/** Bounded replay and per-client backpressure prevent terminals retaining memory. */
export class MissionEvents {
  constructor(private readonly secrets: () => string[]) {}
  private readonly epoch = randomUUID();
  private sequence = 0;
  private readonly history: MissionEvent[] = [];
  private bytes = 0;
  private readonly clients = new Set<ServerResponse>();
  get connected(): boolean { return this.clients.size > 0; }

  publish(payload: EventPayload): MissionEvent {
    const event: MissionEvent = { ...payload, schemaVersion: 1, id: `${this.epoch}:${++this.sequence}`, observedAt: new Date().toISOString() };
    this.history.push(event);
    this.bytes += Buffer.byteLength(JSON.stringify(event));
    while (this.history.length > 512 || this.bytes > 2_000_000) {
      const removed = this.history.shift();
      if (removed) this.bytes -= Buffer.byteLength(JSON.stringify(removed));
    }
    for (const client of this.clients) this.write(client, event);
    return event;
  }
  private write(client: ServerResponse, event: MissionEvent): void {
    if (client.destroyed || client.writableLength > 1_000_000) { client.destroy(); this.clients.delete(client); return; }
    client.write(`id: ${event.id}\nevent: message\ndata: ${redact(JSON.stringify(event), this.secrets())}\n\n`);
  }
  subscribe(response: ServerResponse, lastId: string | undefined, snapshot: Extract<EventPayload, { kind: "snapshot" }>): void {
    if (this.clients.size >= 32) { response.writeHead(503).end(); return; }
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    response.flushHeaders();
    const index = lastId ? this.history.findIndex(event => event.id === lastId) : -1;
    if (lastId && index >= 0) for (const event of this.history.slice(index + 1)) this.write(response, event);
    else if (lastId) this.write(response, { kind: "reset", reason: "Event history expired or daemon restarted", schemaVersion: 1, id: `${this.epoch}:${this.sequence}`, observedAt: new Date().toISOString() });
    // Replayed deltas repair the terminal; the snapshot also covers changes
    // observed while no browser was connected and establishes readiness.
    this.write(response, { ...snapshot, schemaVersion: 1, id: `${this.epoch}:${this.sequence}`, observedAt: new Date().toISOString() });
    this.clients.add(response);
    const heartbeat = setInterval(() => {
      if (response.writableLength > 1_000_000) response.destroy();
      else response.write(": heartbeat\n\n");
    }, 15_000);
    response.on("close", () => { clearInterval(heartbeat); this.clients.delete(response); });
  }
  close(): void { for (const response of this.clients) response.end(); this.clients.clear(); }
}
