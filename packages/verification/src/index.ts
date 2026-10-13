import type { AcceptanceCondition, AcceptanceFinding, Evidence } from "@kor-code/core";

export class VerificationError extends Error {
  constructor(message: string, readonly findings: readonly AcceptanceFinding[]) { super(message); }
}

export class VerificationTracker {
  private readonly evidenceById = new Map<string, Evidence>();
  constructor(readonly acceptance: readonly AcceptanceCondition[], readonly executionId?: string) {}
  addEvidence(evidence: Evidence): void {
    if (evidence.acceptanceId && !this.acceptance.some(condition => condition.id === evidence.acceptanceId)) throw new Error(`Evidence ${evidence.id} references an unknown acceptance condition`);
    if (evidence.executionId && this.executionId && evidence.executionId !== this.executionId) throw new Error(`Evidence ${evidence.id} belongs to execution ${evidence.executionId}`);
    const candidate = structuredClone(this.executionId ? { ...evidence, executionId: this.executionId } : evidence);
    const existing = this.evidenceById.get(evidence.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(candidate)) throw new Error(`Evidence id ${evidence.id} was already recorded with different content`);
      return;
    }
    this.evidenceById.set(evidence.id, candidate);
  }
  addMany(evidence: readonly Evidence[]): void { for (const item of evidence) this.addEvidence(item); }
  evidence(): Evidence[] { return [...this.evidenceById.values()].map(item => structuredClone(item)); }
  findings(): AcceptanceFinding[] {
    return this.acceptance.map(condition => {
      const evidence = this.evidence().filter(item => item.acceptanceId === condition.id);
      const status = evidence.some(item => item.status === "fail") ? "fail" : evidence.some(item => item.status === "pass") ? "pass" : "unresolved";
      return { conditionId: condition.id, status, evidenceIds: evidence.map(item => item.id) };
    });
  }
  assertComplete(): void {
    const findings = this.findings();
    if (findings.some((finding, index) => this.acceptance[index]?.required && finding.status !== "pass")) throw new VerificationError("Completion requires passing evidence for every acceptance condition", findings);
  }
}

export interface ReviewEvidenceOptions { id: string; summary: string; source?: string; acceptanceId?: string }
export function reviewEvidence(options: ReviewEvidenceOptions): Evidence { return { ...options, kind: "review", status: "pass" }; }
