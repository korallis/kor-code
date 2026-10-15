// The next session's guidance for one run: Jev's skills plan with your
// overrides applied, the playbook and the tools. Every button shows what the
// edit costs per turn, or why policy refuses it; the daemon judges and audits it.
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { MissionRun, SessionOption, SessionPackResponse } from '@kor-code/mission-control';
import { useOverride, useSessionPack } from '../api/queries';
import { color, font, fontSize, space, tint, tracking } from '../theme/tokens.stylex';
import { Button } from '../ui/button';
import { Checkbox, TextInput } from '../ui/form';
import { Notice } from '../ui/misc';
import { Pill } from '../ui/pill';
import { layout } from '../ui/layout';
import { text, type Tone } from '../ui/text';
import { compact, count, prob } from '../lib/format';
import { spendOf } from '../lib/runs';

const SHOWN_SKILLS = 8;
const TIER_TONE: Record<SessionPackResponse['skills'][number]['tier'], Tone | 'ghost'> = { pinned: 'violet', listed: 'cyan', armed: 'amber', hidden: 'ghost' };
const SOURCE_LABEL = { jev: 'Jev', override: 'your override', repository: 'repository' } as const;

const styles = stylex.create({
  group: { display: 'flex', flexDirection: 'column', gap: space.s2, paddingBlock: space.s3, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine },
  kind: { fontFamily: font.mono, fontSize: fontSize.microPlus, letterSpacing: tracking.label, textTransform: 'uppercase', color: color.violetBright },
  skill: { display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) auto', gap: space.s2, alignItems: 'center', paddingBlock: space.s1 },
  reasons: { fontSize: fontSize.sm, color: color.textMuted },
});

function delta(value: number | null): string {
  if (value === null) return '';
  return value === 0 ? ' ±0' : ` ${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

export function SessionPackEditor({ executionId }: { executionId: string }) {
  const pack = useSessionPack(executionId);
  const override = useOverride();
  const [overBudget, setOverBudget] = useState(false);
  const [filter, setFilter] = useState('');
  if (pack.error) return <div {...stylex.props(styles.group)}><span {...stylex.props(styles.kind)}>next session</span><span {...stylex.props(styles.reasons)}>{pack.error.message}</span></div>;
  if (!pack.data) return null;
  const { skills, playbook, tools, tokens, budget, planned } = pack.data;
  const send = (target: 'skills' | 'playbook' | 'tools', option: SessionOption) => override.mutate({ executionId, target, choice: option.choice, ...(overBudget ? { overBudget: true } : {}) });
  const optionButton = (target: 'skills' | 'playbook' | 'tools', option: SessionOption, label: string) => (
    <Button key={option.choice} size="sm" variant={option.overBudget ? 'warn' : 'default'} disabled={option.blocked !== null || option.overBudget && !overBudget}
      title={option.blocked ?? (option.overBudget && !overBudget ? 'Over the repository skill budget: tick "Accept over budget" first.' : option.tokenDelta === null ? option.choice : `${option.choice}${delta(option.tokenDelta)} tokens per turn`)}
      busy={override.isPending && override.variables?.choice === option.choice} onClick={() => send(target, option)}>{label}{delta(option.tokenDelta)}</Button>
  );
  const query = filter.trim().toLowerCase();
  const ranked = [...skills].sort((a, b) => Number(b.tier !== 'hidden') - Number(a.tier !== 'hidden') || b.probability - a.probability || a.name.localeCompare(b.name));
  const shown = query ? ranked.filter(skill => skill.name.includes(query)) : ranked.slice(0, Math.max(SHOWN_SKILLS, ranked.filter(skill => skill.tier !== 'hidden').length));
  return (
    <>
      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(layout.row)}>
          <span {...stylex.props(styles.kind)}>next session</span>
          <span {...stylex.props(text.mono, text.sm, tokens.total > budget ? text.amber : text.secondary)}>{count(tokens.total)} / {count(budget)} estimated guidance tokens per turn</span>
          <span {...stylex.props(layout.grow)} />
          <Checkbox checked={overBudget} onChange={setOverBudget} label="Accept over budget" />
        </div>
        <span {...stylex.props(styles.reasons)}>{planned ? 'Estimate using Jev\'s latest plan and your overrides. Jev replans when the next session starts, so its guidance total may change. Edits reach the next repair attempt or retry.' : 'Jev has not planned this run yet, so edits are measured against an empty plan; they apply when the first session starts.'} Repository denials always win; tools stay inside the repository policy.</span>
      </div>
      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(layout.row)}><span {...stylex.props(styles.kind)}>skills</span><span {...stylex.props(layout.grow)} /><TextInput label="Find a skill" value={filter} onChange={setFilter} placeholder="Find a skill" mono /></div>
        {shown.map(skill => (
          <div key={skill.name} {...stylex.props(styles.skill)}>
            <div {...stylex.props(layout.row)}>
              <span {...stylex.props(text.mono, text.sm, text.ellipsis)} title={skill.reason}>{skill.name}</span>
              <Pill tone={TIER_TONE[skill.tier]} small>{skill.tier}</Pill>
              {skill.tier !== skill.jevTier && <span {...stylex.props(text.xs, text.magenta)}>Jev: {skill.jevTier}</span>}
              <span {...stylex.props(text.mono, text.xs, text.muted)}>p {prob(skill.probability)}</span>
            </div>
            <div {...stylex.props(layout.rowWrap)}>{skill.options.map(option => optionButton('skills', option, option.choice.startsWith('skill:-') ? 'hide' : option.choice.slice(option.choice.indexOf('=') + 1)))}</div>
          </div>
        ))}
        {!query && ranked.length > shown.length && <span {...stylex.props(styles.reasons)}>{ranked.length - shown.length} more hidden skills: search by name.</span>}
      </div>
      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(layout.row)}><span {...stylex.props(styles.kind)}>playbook</span><span {...stylex.props(text.mono, text.sm)}>{playbook.selected ?? 'none'}</span>{playbook.selected !== playbook.jev && <span {...stylex.props(text.xs, text.magenta)}>Jev: {playbook.jev ?? 'none'}</span>}</div>
        <div {...stylex.props(layout.rowWrap)}>{playbook.options.map(option => optionButton('playbook', option, option.choice))}</div>
      </div>
      <div {...stylex.props(styles.group)}>
        <div {...stylex.props(layout.row)}><span {...stylex.props(styles.kind)}>tools</span><span {...stylex.props(text.mono, text.xs, text.muted)}>repository policy: {tools.eligible.join(', ') || 'none'}</span></div>
        {tools.overrides.length > 0 && <span {...stylex.props(styles.reasons)}>In force: {tools.overrides.map(tool => `${tool.present ? '+' : '−'}${tool.name}`).join(' ')}; Jev decides the rest per task.</span>}
        <div {...stylex.props(layout.rowWrap)}>{tools.options.map(option => optionButton('tools', option, option.choice.slice('tool:'.length)))}</div>
      </div>
      {override.data?.tokens && override.data.record.status === 'applied' && <Notice tone="ok" title={`Estimated next session: ${count(override.data.tokens.before)} → ${count(override.data.tokens.after)} guidance tokens per turn`} />}
    </>
  );
}

/** What each session of a run actually received, recorded when it launched: the check that an override reached it. */
export function DeliveredPacks({ run }: { run: MissionRun }) {
  const sessions = spendOf(run);
  return (
    <div {...stylex.props(styles.group)}>
      <span {...stylex.props(styles.kind)}>sessions received</span>
      {sessions.map(session => (
        <div key={session.attemptId ?? session.attempt} {...stylex.props(layout.stackTight)}>
          <div {...stylex.props(layout.row)}>
            <span {...stylex.props(text.mono, text.sm, text.strong)}>Attempt {session.attempt}</span>
            <span {...stylex.props(text.mono, text.xs, text.muted)}>{session.model}</span>
            {session.skillPack && <span {...stylex.props(text.mono, text.xs, text.secondary)}>{count(session.skillPack.tokens.total)} guidance tokens per turn</span>}
          </div>
          {session.skillPack ? (
            <div {...stylex.props(layout.rowWrap)}>
              {session.skillPack.skills.map(skill => (
                <span key={skill.name} {...stylex.props(layout.row)} title={`${skill.tier} by ${SOURCE_LABEL[skill.source]}`}>
                  <span {...stylex.props(text.mono, text.sm)}>{skill.name}</span>
                  <Pill tone={TIER_TONE[skill.tier]} small>{skill.tier}</Pill>
                  <span {...stylex.props(text.xs, skill.source === 'override' ? text.magenta : text.muted)}>{SOURCE_LABEL[skill.source]} · {compact(skill.tokens)}</span>
                </span>
              ))}
              {session.skillPack.playbook && <span {...stylex.props(text.sm)}>playbook <b {...stylex.props(text.mono)}>{session.skillPack.playbook.name}</b> · {compact(session.skillPack.playbook.tokens)}</span>}
              {session.skillPack.skills.length === 0 && !session.skillPack.playbook && <span {...stylex.props(styles.reasons)}>No skills or playbook.</span>}
            </div>
          ) : <span {...stylex.props(styles.reasons)}>Not recorded: the session ran without skills or before Kor recorded each session's pack.</span>}
        </div>
      ))}
      {sessions.length === 0 && <span {...stylex.props(styles.reasons)}>No session has finished yet. Each one's skills, playbook and token cost appear here once it ends.</span>}
    </div>
  );
}
