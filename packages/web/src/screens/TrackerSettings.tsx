import type { KorRepositoryConfig } from '@kor-code/config';
import { FieldLabel, Segmented, TextInput } from '../ui/form';

type GitHubSettings = NonNullable<KorRepositoryConfig['github']>;
export function defaultGitHubSettings(repository = ''): GitHubSettings {
  return { repository, statuses: { queued: 'kor:todo', running: 'kor:in-progress', review: 'kor:in-review', complete: 'kor:done', canceled: 'kor:canceled' }, priorities: ['priority:urgent', 'priority:high', 'priority:normal', 'priority:low'], pullRequestLink: 'closes' };
}

export function TrackerSettings({ value, onChange }: { value: GitHubSettings; onChange: (settings: GitHubSettings) => void }) {
  const project = value.project;
  const updateProject = (owner: string, number: number) => onChange({ ...value, project: { owner, number, statusField: project?.statusField ?? 'Status', statuses: project?.statuses ?? { queued: 'Todo', running: 'In Progress', review: 'In Review', complete: 'Done', canceled: 'Canceled' }, ...(project?.priorityField ? { priorityField: project.priorityField } : {}) } });
  return <>
    <FieldLabel>GitHub repository</FieldLabel><TextInput label="GitHub repository" value={value.repository} onChange={repository => onChange({ ...value, repository })} mono placeholder="owner/repository" />
    <FieldLabel>GitHub Project (optional)</FieldLabel><Segmented label="GitHub Project" value={project ? 'project' : 'issues'} options={[{ value: 'issues', label: 'Plain Issues' }, { value: 'project', label: 'Project v2' }]} onChange={choice => { if (choice === 'project') updateProject(value.repository.split('/')[0] ?? '', 1); else { const { project: _, ...settings } = value; onChange(settings); } }} />
    {project && <>
      <FieldLabel>Project owner</FieldLabel><TextInput label="Project owner" value={project.owner} onChange={owner => updateProject(owner, project.number)} mono />
      <FieldLabel>Project number</FieldLabel><TextInput label="Project number" type="number" value={String(project.number)} onChange={number => updateProject(project.owner, Number(number))} mono />
      <FieldLabel>Status field</FieldLabel><TextInput label="Status field" value={project.statusField} onChange={statusField => onChange({ ...value, project: { ...project, statusField } })} />
      <FieldLabel>Priority field (optional)</FieldLabel><TextInput label="Priority field" value={project.priorityField ?? ''} onChange={priorityField => { const { priorityField: _, ...rest } = project; onChange({ ...value, project: priorityField ? { ...rest, priorityField } : rest }); }} />
    </>}
    {(['queued', 'running', 'review', 'complete', 'canceled'] as const).map(state => <TrackerStateField key={state} label={state} value={project ? project.statuses[state] : value.statuses[state]} onChange={name => onChange(project ? { ...value, project: { ...project, statuses: { ...project.statuses, [state]: name } } } : { ...value, statuses: { ...value.statuses, [state]: name } })} />)}
    <FieldLabel>PR linkage</FieldLabel><Segmented label="PR linkage" value={value.pullRequestLink} options={[{ value: 'closes', label: 'Closes issue' }, { value: 'refs', label: 'References issue' }]} onChange={pullRequestLink => onChange({ ...value, pullRequestLink })} />
  </>;
}
function TrackerStateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <><FieldLabel>{label} status</FieldLabel><TextInput label={`${label} status`} value={value} onChange={onChange} /></>;
}
