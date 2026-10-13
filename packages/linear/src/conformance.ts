import { HttpLinearClient } from './client.js';
import { FakeLinearClient } from './fake.js';
import { fixtureFetcher, linearIssueFixture } from './fixture.js';

const fake = new FakeLinearClient([linearIssueFixture]);
const real = new HttpLinearClient({ apiKey: 'fixture', fetcher: fixtureFetcher() });
const [fakeIssue, realIssue, fakeIssues, realIssues] = await Promise.all([
  fake.getIssue(linearIssueFixture.id), real.getIssue(linearIssueFixture.id), fake.listIssues('LEE'), real.listIssues('LEE'),
]);
if (JSON.stringify(fakeIssue) !== JSON.stringify(realIssue) || JSON.stringify(fakeIssues) !== JSON.stringify(realIssues)) throw new Error('fake and HTTP clients diverged on the shared Linear fixture');
console.log(`Linear client conformance: fake=HTTP; teamKey=${realIssue.teamKey}; stateId=${realIssue.stateId}; stateType=${realIssue.stateType}; issues=${realIssues.length}`);
