export const usd = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? '—' : `$${value.toFixed(digits)}`;
export const pct = (value: number | null | undefined, digits = 0) => value === null || value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
export const prob = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2);
export const count = (value: number) => new Intl.NumberFormat('en-GB').format(value);
export const compact = (value: number | null | undefined) => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
/** "claude-sonnet-5-5" → "sonnet-5-5" for the compact model label the design uses. */
export const shortModel = (model: string | undefined) => model ? model.replace(/^claude-/, '') : '—';
export function plural(n: number, one: string, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }
