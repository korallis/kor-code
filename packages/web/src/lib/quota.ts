// Reads quota-axi's JSON (passed through by the daemon as /api/pool quota):
// providers[] with windows[] of { id, label, kind, percentRemaining, resetsAt }.
import type { JsonValue } from '@kor-code/core';

export interface QuotaWindow { id: string; label: string; kind: string; percentRemaining: number | null; resetsAt: string | null; remainingCredits: number | null }
export interface QuotaProvider { provider: string; plan: string | null; status: string | null; notSetUp: boolean; windows: QuotaWindow[] }

const obj = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;

export function parseQuota(raw: JsonValue | null | undefined): QuotaProvider[] {
  const root = obj(raw);
  const providers = Array.isArray(root?.providers) ? root.providers : Array.isArray(raw) ? raw : [];
  return providers.flatMap(item => {
    const entry = obj(item);
    const provider = str(entry?.provider) ?? str(entry?.id);
    if (!entry || !provider) return [];
    const windows = (Array.isArray(entry.windows) ? entry.windows : []).flatMap(value => {
      const window = obj(value);
      const id = str(window?.id);
      if (!window || !id) return [];
      const used = num(window.percentUsed);
      return [{ id, label: str(window.label) ?? id, kind: str(window.kind) ?? 'unknown', percentRemaining: num(window.percentRemaining) ?? (used === null ? null : 100 - used), resetsAt: str(window.resetsAt), remainingCredits: num(window.remainingCredits) }];
    });
    const state = obj(entry.state);
    return [{ provider, plan: str(entry.plan), status: str(state?.status), notSetUp: entry.notSetUp === true, windows }];
  });
}

/** The 5-hour session window and the weekly window of a provider, by kind or id. */
export function sessionWindow(provider: QuotaProvider | undefined): QuotaWindow | undefined {
  return provider?.windows.find(window => window.kind === 'session' || /five_hour|5h|session/i.test(window.id));
}
export function weeklyWindow(provider: QuotaProvider | undefined): QuotaWindow | undefined {
  return provider?.windows.find(window => window.kind === 'weekly' || /seven_day|weekly|week/i.test(window.id));
}
export function headline(provider: QuotaProvider): QuotaWindow | undefined {
  return sessionWindow(provider) ?? weeklyWindow(provider) ?? provider.windows[0];
}
export const providerTitle = (provider: string) => ({ claude: 'Claude', codex: 'Codex', grok: 'Grok', copilot: 'Copilot', cursor: 'Cursor' } as Record<string, string>)[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
