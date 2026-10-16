import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { AskRequest, AskResponse } from "@kor-code/mission-control";
import { atomicPrivateFile } from "./mission-services.js";
import { ApiFailure } from "./api.js";

const entrySchema = z.object({
  input: z.object({ message: z.string().min(1).max(2_000), requestId: z.uuid(), executionId: z.string().optional() }),
  result: z.object({ answer: z.string(), provenance: z.enum(["jev", "unavailable", "uncertain"]), links: z.array(z.object({ label: z.string(), url: z.string() })) }).nullable(),
});

/** Only work waiting for verification is persisted here. Stable request IDs also identify Linear issues. */
export class PendingIntake {
  private entries: z.infer<typeof entrySchema>[] = [];
  private writes: Promise<void> = Promise.resolve();
  private resuming: Promise<void> | undefined;
  constructor(private readonly file: string) {}
  async initialize(): Promise<void> {
    try { this.entries = z.array(entrySchema).max(200).parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new Error("Queued intake is unreadable; restore pending-intake.json before restarting"); }
  }
  get(id: string): AskResponse | undefined {
    const entry = this.entries.find(entry => entry.input.requestId === id);
    return entry ? entry.result ? { schemaVersion: 1, id, actions: [], ...entry.result } : this.waiting(id) : undefined;
  }
  existing(input: AskRequest): AskResponse | undefined {
    const entry = this.entries.find(entry => entry.input.requestId === input.requestId);
    if (entry && (entry.input.message !== input.message || entry.input.executionId !== input.executionId)) throw new ApiFailure(409, "conflict", "Request ID was already used for another message");
    return entry && this.get(entry.input.requestId);
  }
  async defer(input: AskRequest & { requestId: string }): Promise<AskResponse> {
    const existing = this.existing(input);
    if (existing) return existing;
    if (this.entries.filter(entry => !entry.result).length >= 100) throw new ApiFailure(409, "conflict", "The model verification queue is full", "Wait for verification before submitting more work");
    this.entries = [...this.entries.filter(entry => !entry.result), ...this.entries.filter(entry => entry.result).slice(-99), { input, result: null }];
    await this.save();
    return this.waiting(input.requestId);
  }
  private waiting(id: string): AskResponse {
    return { schemaVersion: 1, id, status: "waiting-for-models", provenance: "unavailable", answer: "No model is verified yet. Your request is saved and waiting for model verification. It will continue automatically when a model passes; you can also Verify models now.", actions: [{ kind: "verify-models", label: "Verify models now" }] };
  }
  resume(ready: () => Promise<boolean>, ask: (input: AskRequest) => Promise<AskResponse>, publish: (response: AskResponse) => void): Promise<void> {
    if (this.resuming) return this.resuming;
    this.resuming = (async () => {
      if (!this.entries.some(entry => !entry.result) || !await ready()) return;
      for (const entry of this.entries.filter(entry => !entry.result)) {
        const result = await ask({ message: entry.input.message, requestId: entry.input.requestId, ...(entry.input.executionId ? { executionId: entry.input.executionId } : {}) });
        if (result.status === "waiting-for-models") continue;
        entry.result = { answer: result.answer, provenance: result.provenance, links: result.links ?? [] };
        await this.save();
        publish(result);
      }
    })().finally(() => { this.resuming = undefined; });
    return this.resuming;
  }
  async settle(): Promise<void> { await this.resuming; await this.writes; }
  private save(): Promise<void> {
    const text = JSON.stringify(this.entries);
    const write = this.writes.then(() => atomicPrivateFile(this.file, text));
    this.writes = write.catch(() => undefined);
    return write;
  }
}
