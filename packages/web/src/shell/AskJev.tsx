// Ask Jev: a plain-language question answered over the live snapshot, with the
// suggested actions rendered as buttons that call the same endpoints the
// screens use. The answer reveals word by word; the actions fade in after it.
import * as stylex from '@stylexjs/stylex';
import { AtSign, CornerDownLeft, FolderKanban, GitPullRequest, Hash, MessageSquare, Play, RotateCcw, Slash, Square, Check, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AskResponse, SuggestedAction } from '@kor-code/mission-control';
import { ApiFailure } from '../api/client';
import { useAsk, useQueue, useRunAction } from '../api/queries';
import { navigate } from '../router';
import { color, font, fontSize, glow, gradient, radius, space, tint } from '../theme/tokens.stylex';
import { animate, delayBy } from '../theme/animate';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Notice } from '../ui/misc';
import { JevOrb } from '../ui/orb';
import { layout } from '../ui/layout';
import { text } from '../ui/text';

const styles = stylex.create({
  composer: { position: 'relative', borderRadius: '14px', backgroundColor: color.surfaceSunken, boxShadow: glow.focus, paddingBlock: '12px 10px', paddingInline: '14px 12px' },
  typed: { display: 'flex', alignItems: 'center', gap: space.s2h, fontSize: fontSize.title, color: color.text },
  input: { flex: '1', minWidth: 0, backgroundColor: 'transparent', borderWidth: 0, outline: 'none', color: color.text, fontSize: fontSize.title, '::placeholder': { color: color.textMuted } },
  tools: { display: 'flex', alignItems: 'center', gap: space.s1h, marginTop: space.s2h, flexWrap: 'wrap' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '5px', height: '25px', paddingInline: '9px', borderRadius: '7px', fontSize: fontSize.sm, color: { default: color.textSecondary, ':hover': color.text }, backgroundColor: tint.ghost, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline, cursor: 'pointer' },
  tryLabel: { fontSize: fontSize.sm, color: color.textFaint },
  suggestion: { fontSize: fontSize.sm, color: color.violetBright, paddingBlock: '3px', paddingInline: space.s2h, borderRadius: '99px', borderWidth: '1px', borderStyle: 'solid', borderColor: tint.violetSoftEdge, backgroundColor: { default: tint.violetSoftFill, ':hover': tint.violetFill }, cursor: 'pointer', whiteSpace: 'nowrap' },
  send: { width: '32px', height: '32px', borderRadius: '9px', display: 'grid', placeItems: 'center', backgroundImage: gradient.primaryButton, boxShadow: glow.button, color: tint.white, cursor: 'pointer', flex: 'none' },
  answer: { marginTop: space.s3, paddingBlock: space.s3h, paddingInline: space.s4, borderRadius: '14px', backgroundImage: tint.jevAnswer, borderWidth: '1px', borderStyle: 'solid', borderColor: tint.violetSoftEdge, position: 'relative' },
  who: { display: 'flex', alignItems: 'center', gap: '9px', fontSize: fontSize.base },
  name: { fontFamily: font.display, fontWeight: 600, fontSize: fontSize.md },
  txt: { marginTop: space.s2, color: color.textSecondary, fontSize: fontSize.basePlus, lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  word: { display: 'inline' },
  acts: { display: 'flex', gap: space.s2, marginTop: space.s3, flexWrap: 'wrap' },
  thinking: { color: color.textMuted, fontFamily: font.mono, fontSize: fontSize.xs },
  panel: { borderRadius: radius.xl },
});

const SUGGESTIONS = ['What needs me right now?', 'What can ship today?', 'Work on my next issue'];

/** Issue keys in Jev's answer render violet mono, like everywhere else. */
function words(answer: string): ReactNode[] {
  return answer.split(/(\s+)/).map((part, index) => {
    if (/^\s+$/.test(part)) return part;
    const isKey = /^[A-Z][A-Z0-9]+-\d+[.,;:]?$/.test(part);
    return <span key={index} {...stylex.props(styles.word, animate.fadeInFast, delayBy.ms(Math.min(index, 240) * 9), isKey && text.key)}>{part}</span>;
  });
}

const ACTION_ICON: Record<SuggestedAction['kind'], LucideIcon> = { queue: Play, retry: RotateCcw, cancel: Square, approve: Check, 'open-pr': GitPullRequest, navigate: ArrowRight };

function ActionButton({ action, index, first, wordCount }: { action: SuggestedAction; index: number; first: boolean; wordCount: number }) {
  const queue = useQueue();
  const run = useRunAction();
  const busy = queue.isPending || run.isPending;
  const done = queue.isSuccess || run.isSuccess;
  const onClick = () => {
    if (action.kind === 'queue') queue.mutate({ issueIds: action.issueIds });
    else if (action.kind === 'retry' || action.kind === 'cancel' || action.kind === 'approve') run.mutate({ action: action.kind, executionId: action.executionId });
    else if (action.kind === 'navigate') navigate(action.screen === 'settings' ? 'settings' : action.screen);
  };
  const error = queue.error ?? run.error;
  return (
    <span {...stylex.props(animate.fadeIn, delayBy.ms(Math.min(wordCount, 240) * 9 + 120 + index * 60))}>
      <Button size="sm" variant={first ? 'primary' : action.kind === 'cancel' ? 'danger' : 'default'} icon={done ? Check : ACTION_ICON[action.kind]} busy={busy}
        href={action.kind === 'open-pr' ? action.url : undefined} external={action.kind === 'open-pr'} onClick={action.kind === 'open-pr' ? undefined : onClick}
        title={error instanceof ApiFailure ? `${error.message} ${error.hint}` : undefined}>
        {action.label}
      </Button>
    </span>
  );
}

export function AskAnswer({ response, onFollowUp }: { response: AskResponse; onFollowUp?: () => void }) {
  const count = response.answer.split(/\s+/).length;
  return (
    <div {...stylex.props(styles.answer, animate.fadeInFast)} aria-live="polite">
      <div {...stylex.props(styles.who)}><JevOrb size={26} state="deciding" playKey={response.id} /><b {...stylex.props(styles.name)}>Jev</b><span {...stylex.props(text.mono, text.muted, text.xs)}>just now · read the live snapshot</span></div>
      <div {...stylex.props(styles.txt)}>{words(response.answer)}</div>
      {(response.actions.length > 0 || onFollowUp) && (
        <div {...stylex.props(styles.acts)}>
          {response.actions.map((action, index) => <ActionButton key={`${response.id}-${index}`} action={action} index={index} first={index === 0} wordCount={count} />)}
          {onFollowUp && <span {...stylex.props(animate.fadeIn, delayBy.ms(Math.min(count, 240) * 9 + 120 + response.actions.length * 60))}><Button size="sm" variant="ghost" icon={MessageSquare} onClick={onFollowUp}>Follow up</Button></span>}
        </div>
      )}
    </div>
  );
}

/** The composer plus its latest answer. `executionId` scopes the question to one run. */
export function AskJev({ executionId, initial = '', autoFocus = false, placeholder = 'Ask Jev — queue an issue, explain a decision, change a route…', idle }: { executionId?: string; initial?: string; autoFocus?: boolean; placeholder?: string; idle?: ReactNode }) {
  const [message, setMessage] = useState(initial);
  const ask = useAsk();
  const submit = (value = message) => {
    const trimmed = value.trim();
    if (!trimmed || ask.isPending) return;
    setMessage(trimmed);
    ask.mutate(executionId ? { message: trimmed, executionId } : { message: trimmed });
  };
  const insert = (token: string) => setMessage(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${token}`);
  const refocus = (node: HTMLInputElement | null) => { if (node && autoFocus) node.focus(); };
  return (
    <div>
      <form {...stylex.props(styles.composer)} onSubmit={event => { event.preventDefault(); submit(); }}>
        <div {...stylex.props(styles.typed)}>
          <JevOrb size={18} state={ask.isPending ? 'thinking' : 'idle'} />
          <input ref={refocus} data-autofocus={autoFocus ? '' : undefined} aria-label="Ask Jev" value={message} placeholder={placeholder} onChange={event => setMessage(event.target.value)} {...stylex.props(styles.input)} />
        </div>
        <div {...stylex.props(styles.tools)}>
          <button type="button" {...stylex.props(styles.chip)} onClick={() => insert('@')}><Icon icon={AtSign} size={12} />File</button>
          <button type="button" {...stylex.props(styles.chip)} onClick={() => insert('#')}><Icon icon={Hash} size={12} />Issue</button>
          <button type="button" {...stylex.props(styles.chip)} onClick={() => insert('/')}><Icon icon={Slash} size={12} />Command</button>
          <button type="button" {...stylex.props(styles.chip)} onClick={() => navigate('projects')}><Icon icon={FolderKanban} size={12} />All projects</button>
          <span {...stylex.props(layout.grow)} />
          {ask.isPending ? <span {...stylex.props(styles.thinking)}>Jev is reading the snapshot…</span> : (
            <>
              <span {...stylex.props(styles.tryLabel)}>Try</span>
              {SUGGESTIONS.slice(0, 2).map(suggestion => <button key={suggestion} type="button" {...stylex.props(styles.suggestion)} onClick={() => submit(suggestion)}>{suggestion}</button>)}
            </>
          )}
          <button type="submit" aria-label="Send to Jev" {...stylex.props(styles.send)}><Icon icon={CornerDownLeft} size={14} /></button>
        </div>
      </form>
      {ask.error && <div {...stylex.props(layout.mt3)}><Notice title={ask.error.message} hint={ask.error instanceof ApiFailure ? ask.error.hint : undefined} /></div>}
      {ask.data ? <AskAnswer key={ask.data.id} response={ask.data} onFollowUp={() => setMessage('')} /> : !ask.isPending && idle}
    </div>
  );
}

