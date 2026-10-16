import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { KorRepositoryConfig } from '@kor-code/config';
import type { Execution } from '@kor-code/core';
import { issueSummary } from './contract.js';
import type { TrackerClient, TrackerIssue, TrackerIssueSummary, TrackerWorkflowState, TrackerWrite } from './contract.js';

export type GitHubRequest = (path: string, body?: unknown, method?: 'PUT' | 'PATCH' | 'DELETE') => Promise<unknown>;
export class GitHubApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
type Settings = NonNullable<KorRepositoryConfig['github']>;
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const label = z.object({ name: z.string() });
const issueSchema = z.object({ number: z.number().int().positive(), node_id: z.string(), title: z.string(), body: z.string().nullable(), html_url: z.url(), state: z.enum(['open', 'closed']), state_reason: z.string().nullable().optional(), updated_at: z.string(), labels: z.array(label), pull_request: z.unknown().optional() });
const commentSchema = z.object({ id: z.number(), body: z.string() });
const graphIssue = z.object({ id: z.string(), number: z.number(), title: z.string(), body: z.string().optional().default(''), url: z.url(), state: z.enum(['OPEN', 'CLOSED']), stateReason: z.string().nullable(), updatedAt: z.string(), labels: z.object({ nodes: z.array(label), pageInfo }) });
const issueFields = 'id number title url state stateReason updatedAt labels(first:100) { nodes { name } pageInfo { hasNextPage endCursor } }';
const optionsSchema = z.object({ id: z.string(), name: z.string() });
const fieldSchema = z.object({ id: z.string().optional(), name: z.string().optional(), options: z.array(optionsSchema).optional() });
const fieldValueSchema = z.object({ name: z.string().optional(), number: z.number().optional(), field: z.object({ name: z.string() }).optional() });
const projectItemSchema = z.object({ id: z.string(), fieldValues: z.object({ nodes: z.array(fieldValueSchema), pageInfo }), content: z.discriminatedUnion('__typename', [z.object({ __typename: z.literal('Issue'), number: z.number(), repository: z.object({ nameWithOwner: z.string() }) }), z.object({ __typename: z.enum(['PullRequest', 'DraftIssue']) })]).nullable().transform(content => content?.__typename === 'Issue' ? { number: content.number, repository: content.repository } : null) });
type ProjectItem = z.infer<typeof projectItemSchema>;
const states = ['queued', 'running', 'review', 'complete', 'canceled'] as const;
type State = typeof states[number];
const stateTypes = { queued: 'unstarted', running: 'started', review: 'started', complete: 'completed', canceled: 'canceled' } as const;
const stateNames = { queued: 'Todo', running: 'In Progress', review: 'In Review', complete: 'Done', canceled: 'Canceled' };

/** Issues carry repository-qualified IDs; project item IDs never become issue IDs. */
export class GitHubTracker implements TrackerClient {
  readonly capabilities = { agentSessions: false };
  readonly scope: string;
  constructor(readonly repositoryKey: string, readonly settings: Settings, private readonly request: GitHubRequest) { this.scope = `github:${repositoryKey}`; }
  private number(reference: string): number {
    const number = Number(reference.startsWith(`${this.scope}#`) ? reference.slice(this.scope.length + 1) : reference.replace(/^#/, ''));
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Use a configured GitHub repository and positive issue number');
    return number;
  }
  private async graph(query: string, variables: object): Promise<unknown> {
    const result = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() })).optional() }).parse(await this.request('/graphql', { query, variables }));
    if (result.errors?.length || !result.data) throw new Error('GitHub GraphQL request failed; check Issues and project permissions, field names and status options');
    return result.data;
  }
  private async restPages<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page++) {
      const batch = z.array(schema).parse(await this.request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`));
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
  }
  private async project(): Promise<{ id: string; fields: z.infer<typeof fieldSchema>[] }> {
    const project = this.settings.project;
    if (!project) throw new Error('No GitHub Project configured');
    let cursor: string | null = null;
    let id = '';
    const fields: z.infer<typeof fieldSchema>[] = [];
    do {
      const data = z.object({ repositoryOwner: z.object({ projectV2: z.object({ id: z.string(), viewerCanUpdate: z.boolean(), fields: z.object({ nodes: z.array(fieldSchema), pageInfo }) }).nullable() }).nullable() }).parse(await this.graph(`query($owner:String!,$number:Int!,$cursor:String){repositoryOwner(login:$owner){... on User{projectV2(number:$number){id viewerCanUpdate fields(first:100,after:$cursor){nodes{... on ProjectV2SingleSelectField{id name options{id name}} ... on ProjectV2Field{id name}} pageInfo{hasNextPage endCursor}}}} ... on Organization{projectV2(number:$number){id viewerCanUpdate fields(first:100,after:$cursor){nodes{... on ProjectV2SingleSelectField{id name options{id name}} ... on ProjectV2Field{id name}} pageInfo{hasNextPage endCursor}}}}}}`, { owner: project.owner, number: project.number, cursor }));
      const value = data.repositoryOwner?.projectV2;
      if (!value) throw new Error('GitHub Project inaccessible; grant project scope (Projects read/write for fine-grained tokens)');
      if (!value.viewerCanUpdate) throw new Error('GitHub Project is read-only; grant project scope or Projects read/write');
      id = value.id; fields.push(...value.fields.nodes);
      cursor = value.fields.pageInfo.hasNextPage ? value.fields.pageInfo.endCursor : null;
      if (value.fields.pageInfo.hasNextPage && !cursor) throw new Error('GitHub fields pagination has no cursor');
    } while (cursor);
    return { id, fields };
  }
  private async projectItems(projectId: string): Promise<ProjectItem[]> {
    const rows: ProjectItem[] = [];
    let cursor: string | null = null;
    do {
      const data = z.object({ node: z.object({ items: z.object({ nodes: z.array(projectItemSchema), pageInfo }) }) }).parse(await this.graph(`query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{items(first:100,after:$cursor){nodes{id fieldValues(first:100){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}} ... on ProjectV2ItemFieldNumberValue{number field{... on ProjectV2Field{name}}}} pageInfo{hasNextPage endCursor}} content{__typename ... on Issue{number repository{nameWithOwner}}}} pageInfo{hasNextPage endCursor}}}}}`, { id: projectId, cursor }));
      for (const item of data.node.items.nodes) {
        let after = item.fieldValues.pageInfo.hasNextPage ? item.fieldValues.pageInfo.endCursor : null;
        while (after) {
          const extra = z.object({ node: z.object({ fieldValues: z.object({ nodes: z.array(fieldValueSchema), pageInfo }) }) }).parse(await this.graph(`query($id:ID!,$after:String){node(id:$id){... on ProjectV2Item{fieldValues(first:100,after:$after){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}} ... on ProjectV2ItemFieldNumberValue{number field{... on ProjectV2Field{name}}}} pageInfo{hasNextPage endCursor}}}}}`, { id: item.id, after }));
          item.fieldValues.nodes.push(...extra.node.fieldValues.nodes);
          after = extra.node.fieldValues.pageInfo.hasNextPage ? extra.node.fieldValues.pageInfo.endCursor : null;
        }
        rows.push(item);
      }
      cursor = data.node.items.pageInfo.hasNextPage ? data.node.items.pageInfo.endCursor : null;
      if (data.node.items.pageInfo.hasNextPage && !cursor) throw new Error('GitHub items pagination has no cursor');
    } while (cursor);
    return rows;
  }
  private parse(issue: z.infer<typeof issueSchema>, item?: ProjectItem): TrackerIssue {
    const project = this.settings.project;
    const projectStatus = item?.fieldValues.nodes.find(value => value.field?.name === project?.statusField)?.name;
    const status = issue.state === 'closed' ? (issue.state_reason === 'not_planned' ? 'canceled' : 'complete') : project ? states.find(state => project.statuses[state] === projectStatus) ?? 'queued' : states.find(state => issue.labels.some(label => label.name === this.settings.statuses[state])) ?? 'queued';
    const description = issue.body ?? '';
    const acceptance = /(?:^|\n)#{1,6}\s+Acceptance(?: criteria| conditions)?\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(description.replace(/<!--[\s\S]*?-->/g, ''))?.[1] ?? '';
    const projectPriority = item?.fieldValues.nodes.find(value => value.field?.name === project?.priorityField);
    const namedPriority = ['urgent', 'high', 'normal', 'low'].findIndex(name => projectPriority?.name?.toLowerCase().replace(/^p[0-4]\s*[-:]?\s*/, '') === name);
    const labelPriority = this.settings.priorities.findIndex(name => issue.labels.some(label => label.name === name));
    const priority = projectPriority?.number ?? (namedPriority >= 0 ? namedPriority + 1 : labelPriority + 1);
    return { id: `${this.scope}#${issue.number}`, tracker: 'github', repositoryKey: this.repositoryKey, identifier: `${this.settings.repository}#${issue.number}`, title: issue.title, description, url: issue.html_url, pullRequestLink: `${this.settings.pullRequestLink === 'refs' ? 'Refs' : 'Closes'} ${this.settings.repository}#${issue.number}`, acceptanceCriteria: acceptance.split('\n').map(line => line.replace(/^\s*[-*]\s*(?:\[[ x]\]\s*)?/i, '').trim()).filter(Boolean), teamId: this.scope, teamKey: this.scope, ...(project ? { projectId: `${project.owner}/${project.number}` } : {}), stateId: status, stateType: stateTypes[status], stateName: projectStatus ?? stateNames[status], updatedAt: issue.updated_at, priority, documents: [], dependencies: [], subIssueIds: [], comments: [], sessions: [], resources: [], labels: issue.labels.map(label => label.name) };
  }
  async listIssues(_scope: string, _limit = 100): Promise<TrackerIssueSummary[]> {
    const [owner, name] = this.settings.repository.split('/');
    const items = this.settings.project ? await this.projectItems((await this.project()).id) : undefined;
    const byNumber = new Map(items?.filter(item => item.content?.repository.nameWithOwner.toLowerCase() === this.settings.repository.toLowerCase()).map(item => [item.content?.number, item]));
    const issues: TrackerIssue[] = [];
    let cursor: string | null = null;
    do {
      const data = z.object({ repository: z.object({ issues: z.object({ nodes: z.array(graphIssue), pageInfo }) }) }).parse(await this.graph(`query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){issues(first:50,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){nodes{${issueFields}} pageInfo{hasNextPage endCursor}}}}`, { owner, name, cursor }));
      for (const issue of data.repository.issues.nodes) {
        if (items && !byNumber.has(issue.number)) continue;
        const labels = issue.labels.pageInfo.hasNextPage ? await this.restPages(`/repos/${this.settings.repository}/issues/${issue.number}/labels`, label) : issue.labels.nodes;
        issues.push(this.parse({ number: issue.number, node_id: issue.id, title: issue.title, body: issue.body, html_url: issue.url, state: issue.state === 'OPEN' ? 'open' : 'closed', state_reason: issue.stateReason, updated_at: issue.updatedAt, labels }, byNumber.get(issue.number)));
      }
      cursor = data.repository.issues.pageInfo.hasNextPage ? data.repository.issues.pageInfo.endCursor : null;
      if (data.repository.issues.pageInfo.hasNextPage && !cursor) throw new Error('GitHub issue pagination has no cursor');
    } while (cursor);
    const order = new Map(items?.map((item, index) => [item.content?.number, index]));
    return issues.sort((a, b) => (a.priority || 5) - (b.priority || 5) || (order.get(this.number(a.id)) ?? 0) - (order.get(this.number(b.id)) ?? 0)).map(issueSummary);
  }
  async getIssue(reference: string): Promise<TrackerIssue> {
    const number = this.number(reference);
    const raw = issueSchema.parse(await this.request(`/repos/${this.settings.repository}/issues/${number}`));
    if (raw.pull_request) throw new Error('GitHub pull requests cannot be queued as issues');
    raw.labels = await this.restPages(`/repos/${this.settings.repository}/issues/${number}/labels`, label);
    const items = this.settings.project ? await this.projectItems((await this.project()).id) : undefined;
    const item = items?.find(value => value.content?.number === number && value.content.repository.nameWithOwner.toLowerCase() === this.settings.repository.toLowerCase());
    if (items && !item) throw new Error('Issue is outside the configured GitHub Project');
    const result = this.parse(raw, item);
    result.comments = (await this.restPages(`/repos/${this.settings.repository}/issues/${number}/comments`, commentSchema)).map(comment => ({ id: String(comment.id), body: comment.body }));
    for (const relation of ['blockedBy', 'subIssues'] as const) {
      let cursor: string | null = null;
      do {
        const data = z.object({ node: z.object({ [relation]: z.object({ nodes: z.array(z.object({ id: z.string(), state: z.enum(['OPEN', 'CLOSED']) })), pageInfo }) }) }).parse(await this.graph(`query($id:ID!,$cursor:String){node(id:$id){... on Issue{${relation}(first:100,after:$cursor){nodes{id state} pageInfo{hasNextPage endCursor}}}}}`, { id: raw.node_id, cursor }));
        const connection = data.node[relation];
        if (!connection) throw new Error('GitHub issue relation response missing');
        for (const issue of connection.nodes) {
          if (relation === 'blockedBy') result.dependencies.push({ id: issue.id, stateType: issue.state === 'CLOSED' ? 'completed' : 'unstarted' });
          else result.subIssueIds.push(issue.id);
        }
        cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
        if (connection.pageInfo.hasNextPage && !cursor) throw new Error('GitHub relation pagination has no cursor');
      } while (cursor);
    }
    return result;
  }
  async listWorkflowStates(): Promise<TrackerWorkflowState[]> {
    if (this.settings.project) {
      const project = await this.project();
      const field = project.fields.find(field => field.name === this.settings.project?.statusField);
      for (const state of states) if (!field?.options?.some(option => option.name === this.settings.project?.statuses[state])) throw new Error(`GitHub Project Status mapping missing ${state}; configure an existing option`);
    }
    return states.map(state => ({ id: state, name: stateNames[state], type: stateTypes[state] }));
  }
  private async ensureLabel(name: string): Promise<void> {
    // Creation is idempotent when the label already exists; inspect before creating.
    const labels = await this.restPages(`/repos/${this.settings.repository}/labels`, label);
    if (!labels.some(label => label.name === name)) await this.request(`/repos/${this.settings.repository}/labels`, { name, color: '8250df' });
  }
  private async labels(number: number, names: string[], remove: string[]): Promise<void> {
    for (const name of names) await this.ensureLabel(name);
    if (names.length) await this.request(`/repos/${this.settings.repository}/issues/${number}/labels`, { labels: names });
    const current = await this.restPages(`/repos/${this.settings.repository}/issues/${number}/labels`, label);
    for (const name of remove.filter(name => current.some(label => label.name === name))) await this.request(`/repos/${this.settings.repository}/issues/${number}/labels/${encodeURIComponent(name)}`, undefined, 'DELETE');
  }
  private async comment(number: number, id: string, body: string): Promise<void> {
    const marker = `<!-- kor:${id} -->`;
    const comments = await this.restPages(`/repos/${this.settings.repository}/issues/${number}/comments`, commentSchema);
    if (!comments.some(comment => comment.body.includes(marker))) await this.request(`/repos/${this.settings.repository}/issues/${number}/comments`, { body: `${body}\n\n${marker}` });
  }
  async apply(write: TrackerWrite): Promise<void> {
    if (!('issueId' in write)) throw new Error('GitHub does not support agent sessions');
    const number = this.number(write.issueId);
    const path = `/repos/${this.settings.repository}/issues/${number}`;
    switch (write.kind) {
      case 'comment': await this.comment(number, write.id, write.body); return;
      case 'attachment': await this.comment(number, `attachment:${write.url}`, `[${write.title ?? 'Resource'}](${write.url})`); return;
      case 'label': await this.labels(number, write.present ? [write.name] : [], write.present ? [] : [write.name]); return;
      case 'state': {
        const state = states.find(state => state === write.stateId);
        if (!state) throw new Error('Invalid GitHub tracker state');
        const config = this.settings.project;
        if (config) {
          const project = await this.project();
          const item = (await this.projectItems(project.id)).find(item => item.content?.number === number && item.content.repository.nameWithOwner.toLowerCase() === this.settings.repository.toLowerCase());
          if (!item) throw new Error('GitHub Project does not contain this issue');
          await this.projectState(project, item.id, state);
        } else await this.labels(number, [this.settings.statuses[state]], states.filter(other => other !== state).map(other => this.settings.statuses[other]));
        await this.request(path, { state: state === 'complete' || state === 'canceled' ? 'closed' : 'open', ...(state === 'complete' || state === 'canceled' ? { state_reason: state === 'canceled' ? 'not_planned' : 'completed' } : {}) }, 'PATCH');
        return;
      }
      default: { const exhaustive: never = write; throw new Error(String(exhaustive)); }
    }
  }
  private async projectState(project: Awaited<ReturnType<GitHubTracker['project']>>, itemId: string, state: State): Promise<void> {
    const config = this.settings.project;
    const field = project.fields.find(field => field.name === config?.statusField);
    const option = field?.options?.find(option => option.name === config?.statuses[state]);
    if (!field?.id || !option) throw new Error(`GitHub Project Status mapping missing ${state}`);
    await this.graph('mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}', { project: project.id, item: itemId, field: field.id, option: option.id });
  }
  async createIssue(input: { id: string; teamKey: string; projectId: string; title: string; description: string; labels: string[] }): Promise<TrackerIssue> {
    const marker = `<!-- kor:create:${input.id} -->`;
    // Search every page so a replay after a crash never duplicates a home-box issue.
    let raw = (await this.restPages(`/repos/${this.settings.repository}/issues?state=all`, issueSchema)).find(issue => !issue.pull_request && issue.body?.includes(marker));
    if (!raw) {
      for (const name of input.labels) await this.ensureLabel(name);
      raw = issueSchema.parse(await this.request(`/repos/${this.settings.repository}/issues`, { title: input.title, body: `${marker}\n\n${input.description}`, labels: input.labels }));
    }
    if (this.settings.project) {
      const project = await this.project();
      const added = z.object({ addProjectV2ItemById: z.object({ item: z.object({ id: z.string() }) }) }).parse(await this.graph('mutation($project:ID!,$issue:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$issue}){item{id}}}', { project: project.id, issue: raw.node_id }));
      // The mutation returns the authoritative item before the list index catches up.
      await this.projectState(project, added.addProjectV2ItemById.item.id, 'queued');
      let visible = false;
      for (const wait of [0, 100, 300, 900, 2700]) {
        if (wait) await delay(wait);
        if ((await this.projectItems(project.id)).some(item => item.id === added.addProjectV2ItemById.item.id)) { visible = true; break; }
      }
      if (!visible) throw new Error('GitHub Project item was created; its list index is still catching up. Retry the same request to resume.');
      await this.request(`/repos/${this.settings.repository}/issues/${raw.number}`, { state: 'open' }, 'PATCH');
    } else await this.apply({ kind: 'state', issueId: `${this.scope}#${raw.number}`, stateId: 'queued' });
    return this.getIssue(`${this.scope}#${raw.number}`);
  }
  async setPriority(reference: string, priority: number): Promise<void> {
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw new Error('Priority must be 0–4');
    const chosen = this.settings.priorities[priority - 1];
    await this.labels(this.number(reference), chosen ? [chosen] : [], this.settings.priorities.filter(name => name !== chosen));
    // A configured Project priority overrides labels, so update that same source.
    const config = this.settings.project;
    if (config?.priorityField) {
      const project = await this.project();
      const field = project.fields.find(field => field.name === config.priorityField);
      const item = (await this.projectItems(project.id)).find(item => item.content?.number === this.number(reference) && item.content.repository.nameWithOwner.toLowerCase() === this.settings.repository.toLowerCase());
      if (!field?.id || !item) throw new Error('GitHub Project priority field or issue missing');
      const option = field.options?.find(option => option.name.toLowerCase() === ['none', 'urgent', 'high', 'normal', 'low'][priority]);
      if (priority === 0) await this.graph('mutation($project:ID!,$item:ID!,$field:ID!){clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field}){projectV2Item{id}}}', { project: project.id, item: item.id, field: field.id });
      else await this.graph('mutation($project:ID!,$item:ID!,$field:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:$value}){projectV2Item{id}}}', { project: project.id, item: item.id, field: field.id, value: field.options ? { singleSelectOptionId: option?.id ?? (() => { throw new Error('Priority option must be Urgent, High, Normal or Low'); })() } : { number: priority } });
    }
  }
  async attachImage(reference: string, bytes: Buffer, alt: string): Promise<{ issue: string; url: string; sha256: string; bytes: number }> {
    if (!alt.trim() || alt.length > 500 || /[\r\n]/.test(alt)) throw new Error('Image caption must be 1–500 characters on one line');
    if (bytes.length > 5 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Image must be a PNG no larger than 5 MiB');
    const issue = await this.getIssue(reference);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const repo = z.object({ default_branch: z.string() }).parse(await this.request(`/repos/${this.settings.repository}`));
    const branches = await this.restPages(`/repos/${this.settings.repository}/branches`, z.object({ name: z.string(), commit: z.object({ sha: z.string() }) }));
    const branch = 'kor-assets';
    if (!branches.some(item => item.name === branch)) {
      const base = branches.find(item => item.name === repo.default_branch);
      if (!base) throw new Error('Repository needs an initial commit before attaching images');
      await this.request(`/repos/${this.settings.repository}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.commit.sha });
    }
    const path = `.kor/screens/${sha256}.png`;
    const contentPath = `/repos/${this.settings.repository}/contents/${path}`;
    let exists = false;
    try { await this.request(`${contentPath}?ref=${branch}`); exists = true; }
    catch (error) { if (!(error instanceof GitHubApiError) || error.status !== 404) throw error; }
    if (!exists) await this.request(contentPath, { message: `docs: attach issue screen ${sha256.slice(0, 12)}`, branch, content: bytes.toString('base64') }, 'PUT');
    const savedFile = z.object({ sha: z.string() }).parse(await this.request(`${contentPath}?ref=${branch}`));
    const stored = z.object({ content: z.string(), encoding: z.literal('base64') }).parse(await this.request(`/repos/${this.settings.repository}/git/blobs/${savedFile.sha}`));
    if (!Buffer.from(stored.content, 'base64').equals(bytes)) throw new Error('GitHub image bytes did not match the uploaded PNG');
    const url = `https://raw.githubusercontent.com/${this.settings.repository}/${branch}/${path}`;
    const marker = `<!-- kor:image:${sha256} -->`;
    if (!issue.description?.includes(marker)) await this.request(`/repos/${this.settings.repository}/issues/${this.number(reference)}`, { body: `${issue.description ?? ''}\n\n## Screens\n\n${marker}\n![${alt.replace(/[\[\]\\]/g, '')}](${url})` }, 'PATCH');
    const saved = await this.getIssue(reference);
    if (!saved.description?.includes(url)) throw new Error('GitHub issue image was not saved');
    return { issue: issue.identifier ?? issue.id, url, sha256, bytes: bytes.length };
  }
  async fetchImage(url: string): Promise<Response> {
    const asset = new URL(url);
    if (asset.hostname === 'raw.githubusercontent.com' && !asset.username && !asset.password && !asset.port && asset.protocol === 'https:') {
      const prefix = `/${this.settings.repository}/`;
      if (asset.pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
        const [ref, ...path] = asset.pathname.slice(prefix.length).split('/');
        const file = z.object({ sha: z.string() }).parse(await this.request(`/repos/${this.settings.repository}/contents/${path.join('/')}?ref=${encodeURIComponent(ref ?? '')}`));
        const data = z.object({ content: z.string(), encoding: z.literal('base64') }).parse(await this.request(`/repos/${this.settings.repository}/git/blobs/${file.sha}`));
        return new Response(new Uint8Array(Buffer.from(data.content, 'base64')), { headers: { 'content-type': 'image/png' } });
      }
    }
    return fetch(asset, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  }
  async checkAccess(): Promise<void> {
    const repo = z.object({ has_issues: z.boolean(), permissions: z.object({ push: z.boolean() }).optional() }).parse(await this.request(`/repos/${this.settings.repository}`));
    if (!repo.has_issues || repo.permissions?.push !== true) throw new Error('GitHub tracker needs Issues enabled and repository write access; grant Issues read/write (repo scope for classic tokens)');
    // Actual reads detect fine-grained permission restrictions without mutating tickets.
    await this.request(`/repos/${this.settings.repository}/issues?per_page=1`);
    await this.listWorkflowStates();
  }
  async recordExecution(_execution: Execution): Promise<void> { /* Durable execution state belongs to Kor. */ }
}
