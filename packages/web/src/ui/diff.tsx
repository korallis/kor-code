import * as stylex from '@stylexjs/stylex';
import { FileCode } from 'lucide-react';
import { color, font, fontSize, radius, space, tint } from '../theme/tokens.stylex';
import type { DiffFile } from '../lib/diff';
import { Icon } from './icon';

const styles = stylex.create({
  code: { fontFamily: font.mono, fontSize: fontSize.sm, lineHeight: 1.7, backgroundColor: color.codeBg, borderRadius: radius.md, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', gap: space.s2, paddingBlock: space.s2, paddingInline: space.s3, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: color.hairline, color: color.textSecondary, fontSize: fontSize.xsPlus, backgroundColor: tint.codeHead },
  lang: { marginLeft: 'auto', color: color.textFaint, fontSize: fontSize.microPlus },
  body: { overflowX: 'auto', paddingBlock: space.s1h },
  line: { display: 'grid', gridTemplateColumns: '34px 34px 16px 1fr', whiteSpace: 'pre', color: color.textSecondary, minWidth: 'max-content' },
  n: { color: color.textFaint, textAlign: 'right', paddingRight: space.s2 },
  s: { color: color.textFaint },
  add: { backgroundColor: color.diffAddBg, boxShadow: `inset 2px 0 0 ${color.green}`, color: color.diffAddText },
  del: { backgroundColor: color.diffDelBg, boxShadow: `inset 2px 0 0 ${color.rose}`, color: color.diffDelText },
  hunk: { color: color.syntaxComment },
  add2: { color: color.green },
  del2: { color: color.rose },
});

const LANG: Record<string, string> = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', mjs: 'JavaScript', json: 'JSON', md: 'Markdown', py: 'Python', css: 'CSS', html: 'HTML', yaml: 'YAML', yml: 'YAML', sh: 'Shell', java: 'Java', go: 'Go', rs: 'Rust' };

export function DiffView({ file, maxLines = 400 }: { file: DiffFile; maxLines?: number }) {
  const ext = file.path.split('.').pop() ?? '';
  return (
    <div {...stylex.props(styles.code)}>
      <div {...stylex.props(styles.head)}>
        <Icon icon={FileCode} size={14} />
        <span>{file.path}</span>
        <span {...stylex.props(styles.lang)}>{LANG[ext] ?? ext} · <span {...stylex.props(styles.add2)}>+{file.added}</span> <span {...stylex.props(styles.del2)}>-{file.removed}</span></span>
      </div>
      <div {...stylex.props(styles.body)}>
        {file.lines.slice(0, maxLines).map((line, index) => line.kind === 'hunk'
          ? <div key={index} {...stylex.props(styles.line, styles.hunk)}><span /><span /><span /><span>{line.text}</span></div>
          : (
            <div key={index} {...stylex.props(styles.line, line.kind === 'add' && styles.add, line.kind === 'del' && styles.del)}>
              <span {...stylex.props(styles.n)}>{line.oldNo ?? ''}</span>
              <span {...stylex.props(styles.n)}>{line.newNo ?? ''}</span>
              <span {...stylex.props(styles.s)}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}</span>
              <span>{line.text}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
