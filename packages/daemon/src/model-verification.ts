import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isTextModel, modelFamily, readModelRegistry } from "@kor-code/gateway-adapter";
import { redact, runtimeSecrets, type JevQuestion } from "@kor-code/jev";
import type { ModelVerification } from "@kor-code/mission-control";
import type { MissionServices } from "./mission-services.js";
import { atomicPrivateFile } from "./mission-services.js";

const DAY = 86_400_000;
const PROBE_USD = 0.10;
const DAILY_USD = 2;
const ledgerSchema = z.object({
  day: z.string(), reserved: z.number().nonnegative(),
  attempts: z.record(z.string(), z.number()),
  selection: z.object({ fingerprint: z.string(), at: z.number(), models: z.array(z.string()) }).nullable(),
});

/** Reserve the full per-session limit before launch, including failed or interrupted probes. */
export class ModelVerifier {
  private operation: Promise<void> | undefined;
  private nextCheck = 0;
  private stopped = false;
  private notify = () => {};
  status: ModelVerification = { phase: "idle", currentModel: null, completed: 0, total: 0, reason: null, dailyLimitUsd: DAILY_USD, reservedUsd: 0 };
  constructor(private readonly services: MissionServices) {}
  onChange(notify: () => void): void { this.notify = notify; }
  check(force = false): Promise<void> {
    if (this.operation) return this.operation;
    if (this.stopped || !this.services.canProbe || !force && Date.now() < this.nextCheck) return Promise.resolve();
    this.nextCheck = Date.now() + 60_000;
    this.operation = this.run(force).catch(error => {
      const detail = String(redact(error instanceof Error ? error.message : "Verification unavailable", [...runtimeSecrets(), ...this.services.secrets()])).slice(0, 500);
      this.update({ phase: "paused", currentModel: null, reason: `Automatic verification paused: ${detail}. Retry with Verify models now. Your request stays queued.` });
    }).finally(() => { this.operation = undefined; });
    return this.operation;
  }
  async stop(): Promise<void> { this.stopped = true; await this.operation; }
  private update(patch: Partial<ModelVerification>): void { this.status = { ...this.status, ...patch }; this.notify(); }
  private async run(force: boolean): Promise<void> {
    const file = join(this.services.paths.stateDir, "model-verification.json");
    let ledger: z.infer<typeof ledgerSchema>;
    try { ledger = ledgerSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      ledger = { day: "", reserved: 0, attempts: {}, selection: null };
    }
    const day = new Date().toISOString().slice(0, 10);
    if (ledger.day !== day) { ledger.day = day; ledger.reserved = 0; }
    this.update({ reservedUsd: ledger.reserved });
    const catalogue = (await (await this.services.gateway()).listModels()).data ?? [];
    const models = catalogue.filter(model => isTextModel(model.id)).sort((a, b) => a.id.localeCompare(b.id));
    if (!models.length) { this.update({ phase: "paused", reason: "The gateway offers no text models. Your request stays queued." }); return; }
    const fingerprint = createHash("sha256").update(JSON.stringify(models)).digest("hex");
    if (!ledger.selection || ledger.selection.fingerprint !== fingerprint || Date.now() - ledger.selection.at > 7 * DAY) {
      // Limit repeated selection calls too, including after a crash or Jev outage.
      if (!force && Date.now() - (ledger.attempts["$selection"] ?? 0) < 60_000) return;
      ledger.attempts["$selection"] = Date.now();
      await atomicPrivateFile(file, JSON.stringify(ledger));
      this.update({ phase: "selecting", currentModel: null, completed: 0, total: 0, reason: "Jev is choosing a strong and a cheap coding model per available family." });
      const families = [...new Set(models.map(model => modelFamily(model.id)))];
      const selected: string[] = [];
      for (const tier of ["strong", "cheap"]) {
        const candidates = new Map(families.map(family => {
          const offered = models.filter(model => modelFamily(model.id) === family);
          const alternatives = offered.filter(model => !selected.includes(model.id));
          return [family, alternatives.length ? alternatives : offered];
        }));
        const questions: Record<string, JevQuestion> = Object.fromEntries([...candidates].map(([family, offered]) => {
          const instructions = `Choose one ${tier === "strong" ? "strong, capable" : "cheap, fast"} general-purpose coding model from the ${family} family to verify. Prefer production coding/chat models, not review-only models.`;
          const only = offered.length === 1 ? offered[0] : undefined;
          return [family, only
            ? { type: "noul", instructions: `Should Kor verify ${only.id}, the only remaining model in the ${family} family, for its ${tier} default slot? Verification is a compatibility check, not a claim that the model already works.`, criteria: { true: "Verify this offered model", false: "This is not a text/coding model" } }
            : { type: "choice", instructions, criteria: Object.fromEntries(offered.map(model => [model.id, `${model.owned_by ?? family}: ${model.id}`])) }];
        }));
        const answer = await this.services.jev().evaluate({ purpose: "First-install and catalogue-change compatibility verification", models, selected }, questions);
        for (const [family, result] of Object.entries(answer.answers)) {
          const offered = candidates.get(family) ?? [];
          const id = result.type === "choice" ? result.choice : result.type === "noul" && result.noul >= 0.5 ? offered[0]?.id : undefined;
          if (id && offered.some(model => model.id === id)) selected.push(id);
        }
      }
      if (!selected.length) throw new Error("Jev did not identify a text model to verify");
      ledger.selection = { fingerprint, at: Date.now(), models: [...new Set(selected)] };
      await atomicPrivateFile(file, JSON.stringify(ledger));
    }
    const registry = await readModelRegistry(this.services.paths.modelsFile);
    const selection = ledger.selection;
    const pending = selection.models.filter(id => {
      const result = registry.models.find(model => model.model === id);
      const observedAt = result ? Date.parse(result.observedAt) : 0;
      return (!result?.verified || !Number.isFinite(observedAt) || observedAt < selection.at || Date.now() - observedAt > 7 * DAY)
        && (force || Date.now() - (ledger.attempts[id] ?? 0) >= DAY);
    });
    if (!pending.length) {
      this.update({ phase: "idle", currentModel: null, reason: "Default models checked; catalogue changes are checked every minute." });
      return;
    }
    this.update({ completed: 0, total: pending.length, reason: null });
    for (const id of pending) {
      if (this.stopped) return;
      if (Math.round(ledger.reserved * 100) + Math.round(PROBE_USD * 100) > DAILY_USD * 100) {
        this.update({ phase: "paused", currentModel: null, reason: "Automatic verification reached its $2 daily budget. It resumes after midnight UTC; queued requests are retained." });
        return;
      }
      ledger.reserved = Math.round((ledger.reserved + PROBE_USD) * 100) / 100;
      ledger.attempts[id] = Date.now();
      await atomicPrivateFile(file, JSON.stringify(ledger));
      this.update({ phase: "probing", currentModel: id, reservedUsd: ledger.reserved });
      await this.services.probeModel(id, { maxBudgetUsd: PROBE_USD });
      this.update({ completed: this.status.completed + 1 });
    }
    this.update({ phase: "idle", currentModel: null, reason: "Default verification finished. Failed probes retry after 24 hours, within the daily budget." });
  }
}
