export interface ConcurrencyLimits { total: number; perRepository?: number; perProvider?: number }
export interface ConcurrencyPermit { release(): void }
interface Request { repository?: string; provider?: string; resolve: (permit: ConcurrencyPermit) => void; reject: (error: Error) => void }

export class ConcurrencyLimiter {
  private active = 0;
  private readonly repositories = new Map<string, number>();
  private readonly providers = new Map<string, number>();
  private readonly waiting: Request[] = [];
  constructor(private readonly limits: ConcurrencyLimits) {
    if (!Number.isSafeInteger(limits.total) || limits.total < 1) throw new Error("Total concurrency must be positive");
    for (const value of [limits.perRepository, limits.perProvider]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error("Concurrency limits must be positive");
  }
  acquire(scope: { repository?: string; provider?: string } = {}): Promise<ConcurrencyPermit> {
    return new Promise((resolve, reject) => { this.waiting.push({ ...scope, resolve, reject }); this.pump(); });
  }
  private canStart(request: Request): boolean {
    if (this.active >= this.limits.total) return false;
    if (request.repository && this.limits.perRepository && (this.repositories.get(request.repository) ?? 0) >= this.limits.perRepository) return false;
    if (request.provider && this.limits.perProvider && (this.providers.get(request.provider) ?? 0) >= this.limits.perProvider) return false;
    return true;
  }
  private pump(): void {
    for (let index = 0; index < this.waiting.length; index++) {
      const request = this.waiting[index];
      if (!request || !this.canStart(request)) continue;
      this.waiting.splice(index, 1); index--;
      this.active++;
      if (request.repository) this.repositories.set(request.repository, (this.repositories.get(request.repository) ?? 0) + 1);
      if (request.provider) this.providers.set(request.provider, (this.providers.get(request.provider) ?? 0) + 1);
      let released = false;
      request.resolve({ release: () => { if (released) return; released = true; this.active--; if (request.repository) this.repositories.set(request.repository, (this.repositories.get(request.repository) ?? 1) - 1); if (request.provider) this.providers.set(request.provider, (this.providers.get(request.provider) ?? 1) - 1); this.pump(); } });
    }
  }
  snapshot(): { active: number; waiting: number } { return { active: this.active, waiting: this.waiting.length }; }
}
