// Queue an issue: every open Linear issue across the configured projects that
// Kor is not already running, searchable, queued with POST /api/runs.
import * as stylex from '@stylexjs/stylex';
import { Play, Search } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure } from '../api/client';
import { isOpen, issueKey, useAllIssues } from '../api/issues';
import { useMissionRuns } from '../api/data';
import { useProjects, useQueue } from '../api/queries';
import { color, fontSize, radius, space, tint } from '../theme/tokens.stylex';
import { Button } from '../ui/button';
import { Checkbox, TextInput } from '../ui/form';
import { LinearState, linearStateKind, Priority } from '../ui/glyphs';
import { Dialog, Empty, Notice } from '../ui/misc';
import { Pill, ProvenanceChip } from '../ui/pill';
import { layout } from '../ui/layout';
import { text } from '../ui/text';

const styles = stylex.create({
  list: { maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', borderRadius: radius.md, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairline },
  row: { display: 'grid', gridTemplateColumns: '18px 16px 16px 74px minmax(0, 1fr) auto', gap: space.s2h, alignItems: 'center', paddingBlock: '9px', paddingInline: space.s3, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, fontSize: fontSize.base, cursor: 'pointer', backgroundColor: { default: 'transparent', ':hover': tint.ghost } },
});

export function QueueDialog({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
  const projects = useProjects();
  const list = (projects.data?.projects ?? []).filter(project => !projectId || project.id === projectId);
  const issues = useAllIssues(list);
  const { runs } = useMissionRuns();
  const queue = useQueue();
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const running = new Set(runs.filter(run => !['complete', 'failed', 'canceled'].includes(run.status)).map(run => run.issueId));
  const needle = filter.trim().toLowerCase();
  const candidates = issues.flatMap(entry => entry.issues.map(issue => ({ issue, project: entry.project })))
    .filter(({ issue }) => isOpen(issue) && !running.has(issue.id))
    .filter(({ issue }) => !needle || `${issueKey(issue)} ${issue.title}`.toLowerCase().includes(needle))
    .sort((a, b) => (a.issue.priority || 5) - (b.issue.priority || 5));
  const toggle = (id: string) => setPicked(current => current.includes(id) ? current.filter(one => one !== id) : [...current, id]);
  const submit = () => {
    const [first, ...rest] = picked;
    if (!first) return;
    queue.mutate({ issueIds: [first, ...rest] }, { onSuccess: onClose });
  };
  return (
    <Dialog title="Queue an issue for Kor" onClose={onClose} wide>
      <TextInput label="Filter issues" icon={Search} value={filter} onChange={setFilter} placeholder="Filter by key or title…" autoFocus />
      {issues.some(entry => entry.provenance === 'unavailable') && <ProvenanceChip provenance="unavailable" reason={issues.find(entry => entry.reason)?.reason}>some projects could not be read from Linear</ProvenanceChip>}
      <div {...stylex.props(styles.list)} role="listbox" aria-multiselectable="true">
        {candidates.map(({ issue, project }) => (
          <div key={issue.id} role="option" aria-selected={picked.includes(issue.id)} onClick={() => toggle(issue.id)} {...stylex.props(styles.row)}>
            <Checkbox checked={picked.includes(issue.id)} onChange={() => toggle(issue.id)} label={`Select ${issueKey(issue)}`} />
            <Priority value={issue.priority} />
            <LinearState kind={linearStateKind(issue.stateType, issue.stateName)} />
            <span {...stylex.props(text.key)}>{issueKey(issue)}</span>
            <span {...stylex.props(text.ellipsis)}>{issue.title} <span {...stylex.props(text.muted)}>· {project.name}</span></span>
            {issue.acceptanceCriteria.length === 0 ? <Pill tone="amber" small dot>no criteria</Pill> : <Pill tone="ghost" small>{issue.acceptanceCriteria.length} criteria</Pill>}
          </div>
        ))}
        {candidates.length === 0 && <Empty slot="empty-no-issues" title={issues.some(entry => entry.provenance === 'loading') ? 'Reading Linear…' : 'No open issues to queue.'} />}
      </div>
      {queue.error && <Notice title={queue.error.message} hint={queue.error instanceof ApiFailure ? queue.error.hint : undefined} />}
      <div {...stylex.props(layout.row)}>
        <span {...stylex.props(text.muted, text.sm)}>{picked.length} selected · Jev checks readiness before work starts</span>
        <span {...stylex.props(layout.grow)} />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={Play} busy={queue.isPending} disabled={picked.length === 0} onClick={submit}>Queue for Kor</Button>
      </div>
    </Dialog>
  );
}
