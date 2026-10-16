import * as stylex from '@stylexjs/stylex';
import { FolderKanban } from 'lucide-react';
import { useDriveControl, useProjects } from '../api/queries';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Notice } from '../ui/misc';
import { Pill } from '../ui/pill';
import { layout } from '../ui/layout';
import { text } from '../ui/text';
import { href } from '../router';

export function ProjectDrives({ repository }: { repository?: string }) {
  const projects = useProjects();
  const control = useDriveControl();
  const drives = (projects.data?.projects ?? []).filter(project => !repository || project.id === repository).flatMap(project => project.drives ?? []).slice().reverse();
  if (!drives.length) return null;
  return <section aria-label="Project drives" {...stylex.props(layout.stack)}>
    {control.error && <Notice title={control.error.message} />}
    {drives.map(drive => {
      const count = (status: string) => drive.issues.filter(issue => issue.status === status).length;
      const active = drive.status === 'running' || drive.status === 'paused';
      return <Card key={drive.id}>
        <CardHeader icon={FolderKanban} title={`Project drive · ${drive.name}`} aside={<Pill tone={drive.status === 'running' ? 'cyan' : drive.status === 'finished' ? 'green' : 'amber'} dot>{drive.status}</Pill>} />
        <CardBody>
          <div role="status" aria-live="polite" {...stylex.props(layout.rowWrap)}>
            <b>{count('done')} / {drive.issues.length} Done</b>
            <span>{count('queued')} queued · {count('running')} running · {count('pending')} waiting for blockers · {count('review')} in review · {count('held')} held</span>
            <span {...stylex.props(layout.grow)} />
            <Button size="sm" href={href('projects', drive.repository)}>Open project</Button>
            <Button size="sm" href={drive.url} external>Open in Linear</Button>
            {active && <Button size="sm" busy={control.isPending} onClick={() => control.mutate({ id: drive.id, action: drive.status === 'paused' ? 'resume' : 'pause' })}>{drive.status === 'paused' ? 'Resume drive' : 'Pause drive'}</Button>}
            {active && <Button size="sm" variant="danger" busy={control.isPending} onClick={() => control.mutate({ id: drive.id, action: 'stop' })}>Stop drive</Button>}
          </div>
          {drive.status === 'paused' && <p {...stylex.props(text.muted)}>New work is paused. Runs already started can finish verification and shipping.</p>}
          {drive.status === 'stopped' && <p {...stylex.props(text.muted)}>Drive stopped. Queued and executing runs were canceled; published pull requests retain their review gates.</p>}
          {drive.error && <Notice title="Project synchronization will retry" hint={drive.error} />}
          <ul>{drive.issues.map(issue => <li key={issue.issueId}><b>{issue.key}</b> · {issue.title} · {issue.status}{issue.reason ? ` — ${issue.reason}` : ''}{issue.retries ? ` · ${issue.retries} retries` : ''}</li>)}</ul>
        </CardBody>
      </Card>;
    })}
  </section>;
}
