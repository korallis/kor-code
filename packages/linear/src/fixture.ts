import { object, string, type LinearIssue, type LinearWorkflowState, type WorkflowMapping } from './contract.js';

export const workflowMappingFixture: WorkflowMapping = {
  queued: { id: '00000000-0000-4000-8000-000000000101', type: 'unstarted', name: 'Todo' },
  running: { id: '00000000-0000-4000-8000-000000000102', type: 'started', name: 'In Progress' },
  review: { id: '00000000-0000-4000-8000-000000000104', type: 'started', name: 'In Review' },
  complete: { id: '00000000-0000-4000-8000-000000000103', type: 'completed', name: 'Done' },
  canceled: { id: '00000000-0000-4000-8000-000000000105', type: 'canceled', name: 'Canceled' },
};
export const workflowStatesFixture: readonly LinearWorkflowState[] = Object.values(workflowMappingFixture);
export const linearIssueFixture: LinearIssue = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Fixture issue',
  description: '# Acceptance\n- reaches complete', acceptanceCriteria: ['reaches complete'],
  teamId: '00000000-0000-4000-8000-000000000010', teamKey: 'LEE',
  stateId: workflowMappingFixture.queued.id, stateType: workflowMappingFixture.queued.type,
  updatedAt: new Date(0).toISOString(), priority: 2,
  documents: [], dependencies: [], subIssueIds: [], comments: [], sessions: [], resources: [],
};

function page(nodes: unknown[]) { return { nodes, pageInfo: { hasNextPage: false } }; }
function graphqlIssue(issue: LinearIssue) {
  return {
    id: issue.id, title: issue.title, description: issue.description, updatedAt: issue.updatedAt, priority: issue.priority,
    team: { id: issue.teamId, key: issue.teamKey }, state: { id: issue.stateId, type: issue.stateType }, project: null,
    documents: page(issue.documents), children: page(issue.subIssueIds.map(id => ({ id }))),
    comments: page(issue.comments), agentSessions: page(issue.sessions),
    inverseRelations: page(issue.dependencies.map(dependency => ({ type: 'blocks', issue: { id: dependency.id, state: { type: dependency.stateType } } }))),
    attachments: page(issue.resources),
  };
}

// An independent wire fixture for HttpLinearClient. It intentionally does not
// call FakeLinearClient: the same conformance script must detect drift between them.
export function fixtureFetcher(seed: LinearIssue = linearIssueFixture): typeof globalThis.fetch {
  const issue = structuredClone(seed);
  const sessions = new Map<string, { issueId: string; executionId: string }>();
  const activities = new Map<string, string>();
  const comments = new Map<string, string>();
  const states = new Map(workflowStatesFixture.map(state => [state.id, state.type]));
  return async (url, init) => {
    if (String(url) !== 'https://api.linear.app/graphql') throw new Error('Unexpected fixture URL');
    const request = object(JSON.parse(String(init?.body)));
    const query = string(request.query);
    const variables = object(request.variables);
    let data: unknown;
    if (query.startsWith('query KorIssue(')) {
      data = { issue: variables.id === issue.id ? graphqlIssue(issue) : null };
    } else if (query.startsWith('query KorIssues(')) {
      data = { issues: page(variables.key === issue.teamKey ? [graphqlIssue(issue)] : []) };
    } else if (query.startsWith('query KorWorkflowStates(')) {
      data = { workflowStates: page(workflowStatesFixture.map(state => ({ id: state.id, name: state.name ?? state.type, type: state.type }))) };
    } else if (query.startsWith('query KorSession(')) {
      const session = sessions.get(string(variables.id));
      data = { agentSession: session ? { id: variables.id, issue: { id: session.issueId }, context: { executionId: session.executionId } } : null };
    } else if (query.startsWith('query KorActivity(')) {
      const sessionId = activities.get(string(variables.id));
      if (!sessionId) return new Response(JSON.stringify({ data: null, errors: [{ extensions: { code: 'INPUT_ERROR' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      data = { agentActivity: sessionId ? { id: variables.id, agentSession: { id: sessionId } } : null };
    } else if (query.startsWith('query KorComment(')) {
      const issueId = comments.get(string(variables.id));
      if (!issueId) return new Response(JSON.stringify({ data: null, errors: [{ extensions: { code: 'INPUT_ERROR' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      data = { comment: issueId ? { id: variables.id, issue: { id: issueId } } : null };
    } else {
      const input = object(variables.input);
      if (query.startsWith('mutation KorSession(')) {
        const id = string(input.id);
        if (input.issueId !== issue.id || sessions.has(id)) throw new Error('Invalid fixture session create');
        sessions.set(id, { issueId: issue.id, executionId: string(object(input.context).executionId) });
        issue.sessions.push({ id, status: 'pending' });
        data = { agentSessionCreate: { success: true } };
      } else if (query.startsWith('mutation KorState(')) {
        const type = states.get(string(input.stateId));
        if (variables.id !== issue.id || !type) throw new Error('Invalid fixture state update');
        issue.stateId = string(input.stateId); issue.stateType = type;
        data = { issueUpdate: { success: true } };
      } else if (query.startsWith('mutation KorSummary(')) {
        if (!sessions.has(string(variables.id))) throw new Error('Invalid fixture session update');
        string(input.summary);
        data = { agentSessionUpdate: { success: true } };
      } else if (query.startsWith('mutation KorActivity(')) {
        const id = string(input.id);
        const sessionId = string(input.agentSessionId);
        if (!sessions.has(sessionId) || activities.has(id)) throw new Error('Invalid fixture activity create');
        activities.set(id, sessionId);
        data = { agentActivityCreate: { success: true } };
      } else if (query.startsWith('mutation KorComment(')) {
        const id = string(input.id);
        if (!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/i.test(id)) throw new Error('Fixture comment IDs must be UUID v4');
        if (input.issueId !== issue.id || comments.has(id)) throw new Error('Invalid fixture comment create');
        comments.set(id, issue.id); issue.comments.push({ id, body: string(input.body) });
        data = { commentCreate: { success: true } };
      } else if (query.startsWith('mutation KorCommentUpdate(')) {
        const id = string(variables.id);
        if (!comments.has(id)) throw new Error('Invalid fixture comment update');
        const index = issue.comments.findIndex(comment => comment.id === id);
        if (index < 0) throw new Error('Invalid fixture comment issue');
        const comment = issue.comments[index];
        if (!comment) throw new Error('Invalid fixture comment issue');
        issue.comments[index] = { id: comment.id, body: string(input.body) };
        data = { commentUpdate: { success: true } };
      } else if (query.startsWith('mutation KorAttachment(')) {
        if (input.issueId !== issue.id) throw new Error('Invalid fixture attachment');
        issue.resources.push({ title: typeof input.title === 'string' ? input.title : 'GitHub pull request', url: string(input.url) });
        data = { attachmentLinkGitHubPR: { success: true } };
      } else throw new Error('Unexpected fixture operation');
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
