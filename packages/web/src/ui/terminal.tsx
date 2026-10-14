import * as stylex from '@stylexjs/stylex';
import { useRef, type UIEvent } from 'react';
import { color, font } from '../theme/tokens.stylex';
import { animate } from '../theme/animate';
import type { LineTone, TermLine } from '../lib/terminal';

const styles = stylex.create({
  term: { fontFamily: font.mono, fontSize: '12px', lineHeight: 1.72, color: color.textSecondary, backgroundColor: color.codeBg, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, paddingBlock: '14px', paddingInline: '18px', scrollbarWidth: 'thin', scrollbarColor: `${color.hairlineStrong} transparent` },
  line: { display: 'grid', gridTemplateColumns: '60px 72px minmax(0, 1fr)', columnGap: '12px' },
  body: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  ts: { color: color.textFaint },
  plain: { color: color.textSecondary },
  tool: { color: color.cyan },
  ok: { color: color.green },
  warn: { color: color.amber },
  err: { color: color.rose },
  jev: { color: color.violetBright },
  dim: { color: color.textMuted },
  hi: { color: color.text },
  cursor: { display: 'inline-block', width: '8px', height: '14px', backgroundColor: color.cyan, boxShadow: `0 0 8px ${color.cyan}`, verticalAlign: '-2px', marginLeft: '4px' },
  empty: { color: color.textMuted, paddingBlock: '24px' },
});

const TONE: Record<LineTone, stylex.StyleXStyles> = { plain: styles.plain, tool: styles.tool, ok: styles.ok, warn: styles.warn, err: styles.err, jev: styles.jev, dim: styles.dim, hi: styles.hi };

/** The streamed run output. Follows the tail until the reader scrolls up. */
export function Terminal({ lines, live, empty, label }: { lines: readonly TermLine[]; live: boolean; empty: string; label: string }) {
  const pinned = useRef(true);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
  };
  const follow = (node: HTMLDivElement | null) => {
    const log = node?.parentElement;
    if (log && pinned.current) log.scrollTop = log.scrollHeight;
  };
  return (
    <div role="log" aria-live="polite" aria-label={label} onScroll={onScroll} {...stylex.props(styles.term)}>
      {lines.length === 0 && <div {...stylex.props(styles.empty)}>{empty}</div>}
      {lines.map((line, index) => (
        <div key={line.key} ref={index === lines.length - 1 ? follow : undefined} {...stylex.props(styles.line, animate.lineIn)}>
          <span {...stylex.props(styles.ts)}>{line.time}</span>
          <span {...stylex.props(TONE[line.whoTone])}>{line.who}</span>
          <span {...stylex.props(styles.body, TONE[line.tone])}>{line.body}{live && index === lines.length - 1 && <span {...stylex.props(styles.cursor, animate.blink)} />}</span>
        </div>
      ))}
    </div>
  );
}
