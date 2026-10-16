export * from '@kor-code/tracker';
export type { TrackerIssue as LinearIssue, TrackerIssueSummary as LinearIssueSummary, TrackerDocumentSummary as LinearDocumentSummary, TrackerStateType as LinearStateType, TrackerWorkflowState as LinearWorkflowState, TrackerWrite as LinearWrite, TrackerClient as LinearClient, TrackerCapabilities as LinearClientCapabilities } from '@kor-code/tracker';
import { array, connection, object, string, stateType, type TrackerIssue as LinearIssue, type TrackerIssueSummary as LinearIssueSummary } from '@kor-code/tracker';

export function parseIssue(value: unknown): LinearIssue {
  const data = object(value);
  const summary = parseIssueSummary(value);
  const project = data.project === null ? undefined : object(data.project);
  const description = data.description === null ? '' : string(data.description);
  const documents = [...connection(data.documents), ...(project ? connection(project.documents) : [])].map(value => {
    const document = object(value);
    return { id: string(document.id), title: string(document.title), content: document.content === null ? '' : string(document.content) };
  });
  // Acceptance remains explicit in description; Jev owns interpretation/readiness.
  const acceptanceSection = /(?:^|\n)#{1,6}\s+Acceptance(?: criteria| conditions)?\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(description)?.[1] ?? '';
  return {
    ...summary, description, documents,
    acceptanceCriteria: acceptanceSection.split('\n').map(line => line.replace(/^\s*[-*]\s*(?:\[[ x]\]\s*)?/i, '').trim()).filter(Boolean),
    comments: connection(data.comments).map(value => { const comment = object(value); return { id: string(comment.id), body: string(comment.body) }; }),
    sessions: connection(data.agentSessions).map(value => { const session = object(value); return { id: string(session.id), status: string(session.status) }; }),
    resources: connection(data.attachments).map(value => { const attachment = object(value); return { title: string(attachment.title), url: string(attachment.url) }; }),
  };
}

export function parseIssueSummary(value: unknown): LinearIssueSummary {
  const data = object(value);
  const project = data.project === null ? undefined : object(data.project);
  const state = object(data.state);
  const dependencies = connection(data.inverseRelations).flatMap(value => {
    const relation = object(value);
    if (relation.type !== 'blocks') return [];
    const issue = object(relation.issue);
    return [{ id: string(issue.id), stateType: stateType(object(issue.state).type) }];
  });
  if (typeof data.priority !== 'number' || !Number.isFinite(data.priority)) throw new Error('Linear priority is invalid');
  return {
    id: string(data.id), title: string(data.title),
    ...(project ? { projectId: string(project.id) } : {}),
    teamId: string(object(data.team).id), teamKey: string(object(data.team).key), stateId: string(state.id), stateType: stateType(state.type),
    ...(typeof data.identifier === 'string' ? { identifier: data.identifier } : {}), ...(typeof data.url === 'string' ? { url: data.url } : {}), ...(typeof state.name === 'string' ? { stateName: state.name } : {}),
    updatedAt: string(data.updatedAt), priority: data.priority, dependencies,
    subIssueIds: connection(data.children).map(value => string(object(value).id)),
    labels: data.labels === undefined ? [] : connection(data.labels).map(value => string(object(value).name)),
  };
}
