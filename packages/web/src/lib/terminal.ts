// Turns the daemon's run log and the session's stream-json output into
// terminal lines: a time, who acted (kor, jev, session, a tool) and what.
export type LineTone = 'plain' | 'tool' | 'ok' | 'warn' | 'err' | 'jev' | 'dim' | 'hi';
export interface TermLine { key: string; time: string; who: string; whoTone: LineTone; body: string; tone: LineTone; extra?: string; extraTone?: LineTone }

import { usd } from './format';

const ISO = /^(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z)\s+(.*)$/;

function localTime(iso: string): string {
  const date = new Date(Date.parse(iso));
  return Number.isFinite(date.getTime()) ? date.toTimeString().slice(0, 8) : '';
}

function str(value: unknown): string { return typeof value === 'string' ? value : ''; }

function toolSummary(name: string, input: Record<string, unknown>): string {
  const filePath = str(input.file_path) || str(input.path) || str(input.notebook_path);
  if (filePath) return filePath;
  if (str(input.command)) return str(input.command);
  if (str(input.pattern)) return `"${str(input.pattern)}"${str(input.path) ? ` in ${str(input.path)}` : ''}`;
  if (str(input.url)) return str(input.url);
  if (str(input.description)) return str(input.description);
  return name === 'TodoWrite' ? 'updated the plan' : JSON.stringify(input).slice(0, 160);
}

function daemonLine(key: string, time: string, message: string): TermLine {
  if (/^calibration baseline\b/.test(message)) return { key, time, who: 'baseline', whoTone: 'dim', body: message.slice('calibration baseline '.length), tone: 'dim' };
  const jev = /^(jev|route|readiness|risk|complexity|context|skill|agent|acceptance|supervise)\b/i.test(message) || /\bjev\b/i.test(message);
  const tone: LineTone = /fail|error|blocked|denied|refused/i.test(message) ? 'warn' : /verified|passed|complete|opened|shipped/i.test(message) ? 'ok' : jev ? 'jev' : 'plain';
  return { key, time, who: jev ? 'jev' : 'kor', whoTone: jev ? 'jev' : 'dim', body: message, tone };
}

function sessionLines(key: string, time: string, event: Record<string, unknown>): TermLine[] {
  const type = str(event.type);
  if (type === 'system' && str(event.subtype) === 'init') {
    const tools = Array.isArray(event.tools) ? event.tools.length : 0;
    return [{ key, time, who: 'session', whoTone: 'dim', body: `${str(event.model) || 'session'} started${tools ? ` · ${tools} tools allowed` : ''}`, tone: 'plain' }];
  }
  if (type === 'result') {
    const cost = typeof event.total_cost_usd === 'number' ? ` · ${usd(event.total_cost_usd)}` : '';
    const turns = typeof event.num_turns === 'number' ? ` · ${event.num_turns} turns` : '';
    const failed = event.is_error === true || str(event.subtype).startsWith('error');
    return [{ key, time, who: 'session', whoTone: 'dim', body: `${failed ? 'ended with an error' : 'finished'}${turns}${cost}`, tone: failed ? 'err' : 'ok' }];
  }
  const message = (event.message ?? {}) as Record<string, unknown>;
  const content = Array.isArray(message.content) ? message.content as Record<string, unknown>[] : [];
  const out: TermLine[] = [];
  content.forEach((block, index) => {
    const k = `${key}.${index}`;
    if (block.type === 'tool_use') out.push({ key: k, time, who: str(block.name) || 'tool', whoTone: 'tool', body: toolSummary(str(block.name), (block.input ?? {}) as Record<string, unknown>), tone: 'hi' });
    else if (block.type === 'text' && str(block.text).trim()) out.push({ key: k, time, who: 'claude', whoTone: 'dim', body: str(block.text).trim().split('\n')[0]!.slice(0, 400), tone: 'plain' });
    else if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? (block.content as Record<string, unknown>[]).map(part => str(part.text)).join(' ') : '';
      const first = text.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
      if (block.is_error === true) out.push({ key: k, time, who: '', whoTone: 'dim', body: /^[✗✕×]/.test(first) ? first.slice(0, 300) : `✗ ${first.slice(0, 300)}`, tone: 'warn' });
      else if (/pass|✓|ok\b|exit 0/i.test(first)) out.push({ key: k, time, who: '', whoTone: 'dim', body: /^[✓✔]/.test(first) ? first.slice(0, 300) : `✓ ${first.slice(0, 300)}`, tone: 'ok' });
    }
  });
  return out;
}

/** Parse a whole terminal transcript. Keys are stable by line position so streaming appends never remount earlier lines. */
export function parseTerminal(text: string): TermLine[] {
  const lines: TermLine[] = [];
  let lastTime = '';
  text.split('\n').forEach((raw, index) => {
    const line = raw.trimEnd();
    if (!line) return;
    const key = String(index);
    const stamped = ISO.exec(line);
    if (stamped) { lastTime = localTime(stamped[1]!); lines.push(daemonLine(key, lastTime, stamped[3]!)); return; }
    if (line.startsWith('{')) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const at = str(event.timestamp);
        if (at) lastTime = localTime(at);
        lines.push(...sessionLines(key, lastTime, event));
        return;
      } catch { /* not JSON: print as is */ }
    }
    lines.push({ key, time: lastTime, who: '', whoTone: 'dim', body: line, tone: /error|fail/i.test(line) ? 'warn' : 'plain' });
  });
  return lines;
}

/** Tool steps (Read, Edit, Bash …) from a transcript, for the decision screen's step list. */
export function toolSteps(lines: readonly TermLine[]): TermLine[] {
  return lines.filter(line => line.whoTone === 'tool');
}

export interface SessionUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number | null; final: boolean }

/** Token usage from the session's stream-json: the final result when present, else the running sum of assistant turns. */
export function sessionUsage(text: string): SessionUsage | null {
  let sum: SessionUsage | null = null;
  for (const raw of text.split('\n')) {
    if (!raw.startsWith('{')) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
    const usage = (event.type === 'result' ? event.usage : (event.message as Record<string, unknown> | undefined)?.usage) as Record<string, unknown> | undefined;
    if (!usage || (event.type !== 'result' && event.type !== 'assistant')) continue;
    const n = (key: string) => typeof usage[key] === 'number' ? usage[key] as number : 0;
    if (event.type === 'result') {
      return { inputTokens: n('input_tokens'), outputTokens: n('output_tokens'), cacheReadTokens: n('cache_read_input_tokens'), cacheCreationTokens: n('cache_creation_input_tokens'), costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null, final: true };
    }
    sum = sum ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: null, final: false };
    sum.inputTokens += n('input_tokens'); sum.outputTokens += n('output_tokens'); sum.cacheReadTokens += n('cache_read_input_tokens'); sum.cacheCreationTokens += n('cache_creation_input_tokens');
  }
  return sum;
}
