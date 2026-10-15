import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, readFile, unlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
// Run after pnpm build. All external writes and lifecycle commands are fixtures.
const repo = fileURLToPath(new URL('../', import.meta.url));
const { GitHubShipping, KorDaemon, readStatus } = await import(pathToFileURL(join(repo, 'packages/daemon/dist/index.js')));
const { createController, RepositoryRegistry } = await import(pathToFileURL(join(repo, 'packages/controller/dist/index.js')));
const { CalibrationStore } = await import(pathToFileURL(join(repo, 'packages/calibration/dist/index.js')));
const { FakeLinearClient, LinearStore } = await import(pathToFileURL(join(repo, 'packages/linear/dist/index.js')));
const { linearIssueFixture, workflowMappingFixture } = await import(pathToFileURL(join(repo, 'packages/linear/dist/fixture.js')));
const { JevClient, JevDecisionCore, MemoryDecisionAuditLog } = await import(pathToFileURL(join(repo, 'packages/jev/dist/index.js')));
const { runtimePaths, parseKorConfig } = await import(pathToFileURL(join(repo, 'packages/config/dist/index.js')));
const { encode } = await import(createRequire(new URL('../packages/daemon/package.json', import.meta.url)).resolve('@toon-format/toon'));
const fixtureJev = () => new JevClient({ apiKey: 'fixture-only', fetch: async (_url, options) => {
  const { questions } = JSON.parse(options.body);
  assert(Object.values(questions).every(question => question.type === 'noul'));
  return Response.json({ model: 'fixture', answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: 0.99 }])) });
} });
const exec = promisify(execFile);
const parent = process.env.KOR_PROOF_DIR ?? tmpdir();
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'kor-shipping-proof-'));
const secret = 'sk-ant-fixture-not-a-real-token-123456789';
const leak = `token=${secret} Bearer fixture-bearer-123 /home/fixture/private/project C:\\Users\\fixture\\private file:///tmp/private/output`;
const envelope = value => ({code:0,stdout:encode(value),stderr:''});
const ok = (stdout = '') => ({code:0,stdout,stderr:''});
const real = async (file,args,cwd) => {
  try { return {code:0,...await exec(file,args,{cwd})}; }
  catch(error) { return {code:typeof error.code==='number'?error.code:-1,stdout:error.stdout??'',stderr:error.stderr??error.message}; }
};
const wait = async predicate => {
  for(let i=0;i<1000;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}
  throw new Error('timed out waiting for lifecycle');
};
for(const mode of ['direct','no-mistakes']) {
  const home = join(root,mode); await mkdir(home,{recursive:true});
  const paths=runtimePaths({HOME:home});
  const issue={...structuredClone(linearIssueFixture),identifier:'LEE-600',title:'Write hello.js',labels:['kor'],acceptanceCriteria:['hello.js writes hello to stdout'],description:'# Acceptance\n- hello.js writes hello to stdout'};
  const fake = new FakeLinearClient([issue]);
  const linear={capabilities:{agentSessions:false},getIssue:id=>fake.getIssue(id),listIssues:(...args)=>fake.listIssues(...args),listWorkflowStates:(...args)=>fake.listWorkflowStates(...args),apply:write=>fake.apply(write),recordExecution:e=>fake.recordExecution(e)};
  const store=new LinearStore(paths.databaseFile); const queued=store.enqueue(issue.id);
  const cwd=join(paths.worktreesDir,queued.executionId); await mkdir(cwd,{recursive:true});
  await exec('git',['init','-q','-b','kor/LEE-600',cwd]);
  await exec('git',['config','user.name','Kor shipping proof'],{cwd}); await exec('git',['config','user.email','kor@example.invalid'],{cwd});
  await writeFile(join(cwd,'README.md'),'shipping proof\n'); await exec('git',['add','--','README.md'],{cwd}); await exec('git',['commit','-qm','fixture root'],{cwd});
  const repository={path:cwd,remote:'https://github.com/example/kor-fixture.git',defaultBranch:'main',checks:['node hello.js'],toolAllowlist:[],linearTeam:'LEE'};
  const config=parseKorConfig({repos:{LEE:repository},pollIntervalSeconds:3600});
  await writeFile(`${cwd}.kor-worktree.json`,JSON.stringify({executionId:queued.executionId,issueId:issue.id,path:cwd,repository:cwd}));
  let head, published=false, merged=false, closed=false, dirty=false, mismatched=false, removed=0, launches=0, starts=0, gate=true, check='none', daemonUp=true, creates=0;
  const commands=[];
  const pr=()=>({number:1,html_url:'https://github.com/example/kor-fixture/pull/1',state:merged||closed?'closed':'open',merged_at:merged?'2026-10-14T18:00:00Z':null,draft:false,head:{sha:head,ref:'kor/LEE-600'},base:{ref:'main'}});
  const pipeline=()=>({run:{id:'pipeline-one',branch:'kor/LEE-600',status:'running',head_sha:head,...(published?{pr:pr().html_url}:{}),steps:[{step:'review',status:gate?'awaiting_approval':'passed',duration_ms:10},{step:'test',status:gate?'pending':'passed',duration_ms:20},{step:'ci',status:'running',duration_ms:30}]},...(gate?{gate:{step:'review',status:'awaiting_approval',summary:'Resolve finding'}}:{})});
  const command=async(file,args,dir)=>{
    commands.push([file,...args]);
    if(file==='git'&&args[0]==='push'){assert.equal(args[2],`${head}:refs/heads/kor/LEE-600`);return ok();}
    if(file==='git'&&args[0]==='worktree'){
      if(args[1]==='list')return ok(`worktree ${cwd}\nHEAD ${head}\nbranch refs/heads/${mismatched ? 'other-branch' : 'kor/LEE-600'}\n\n`);
      assert.deepEqual(args,['worktree','remove',cwd]); removed++; return ok();
    }
    if(file==='git'&&args[0]==='status'&&dirty)return ok(' M README.md');
    if(file==='git'&&args[0]==='add'){assert.equal(args.length,3);assert.equal(args[1],'--');assert(args[2].startsWith(':(literal)'));}
    if(file==='git') {const result=await real(file,args,dir);if(args[0]==='rev-parse')head=result.stdout.trim();return result;}
    if(file==='no-mistakes'){
      if(args[0]==='daemon')return daemonUp?ok('● daemon running (pid 1)'):ok('daemon not running');
      if(mode==='direct')return {code:1,stdout:encode({error:"repo not initialized (run 'no-mistakes init' first)"}),stderr:''};
      if(args[1]==='status')return ok(encode(starts?pipeline():{current_branch:'kor/LEE-600',runs_on_current_branch:0}));
      assert.equal(args[1],'run');assert(args.includes('--intent'));assert(!args.includes('--yes'));assert(args.includes('--no-publish-intent'));starts++;return ok(encode(pipeline()));
    }
    if(file==='gh-axi'&&args[0]==='pr') {
      assert.equal(args[1],'create');creates++;assert(!args.includes('--draft'));
      assert.equal(args[args.indexOf('--title')+1],'chore(task): Write hello.js');
      const body=await readFile(args.at(-1),'utf8');
      assert.deepEqual(body.match(/^## .+$/gm),['## What does this PR do?','## Changelog','## How was it tested?','## Screenshots','## Checklist']);
      assert(body.includes('- Changed: Write hello.js'));assert(body.includes('- [x]'));assert(body.includes('Evidence truncated'));
      assert(body.includes('node hello.js'));assert(body.includes('[redacted]'));assert(!body.includes(secret));assert(!body.includes('fixture-bearer-123'));assert(!body.includes('/home/fixture'));assert(!body.includes('C:\\Users'));assert(!body.includes('/tmp/private'));assert(!body.includes(cwd));assert(body.length<=60000);
      await writeFile(join(home,'pr-body.md'),body);published=true;return ok('pr:\n  url: https://github.com/example/kor-fixture/pull/1');
    }
    if(file==='gh-axi'&&args[0]==='api') {
      const path=args[1];
      if(path.includes('/pulls?'))return envelope(published?[pr()]:[]);
      if(path.endsWith('/pulls/1'))return envelope(pr());
      if(path.includes('/check-runs'))return envelope({total_count:check==='none'?0:1,check_runs:check==='none'?[]:[{name:'ci',status:'completed',conclusion:check,html_url:null}]});
      if(path.includes('/status?'))return envelope({total_count:0,statuses:[]});
    }
    throw new Error(`Unexpected command ${file} ${args.join(' ')}`);
  };
  const shipping=new GitHubShipping(command);
  const calibration=new CalibrationStore(paths.databaseFile);
  const controller=createController({repositories:new RepositoryRegistry([{key:'LEE',...repository}]),worktrees:{create:async input=>({executionId:input.executionId,issueId:input.issueId,path:cwd,branch:input.branch,repository:cwd})},launcher:{launch:async()=>{launches++;await writeFile(join(cwd,'hello.js'),"console.log('hello');\n");await writeFile(join(cwd,'feature [literal].txt'),'literal filename\n');return {exitCode:0,events:[],stdout:'',stderr:'',failed:false};}},jev:new JevDecisionCore(fixtureJev(),new MemoryDecisionAuditLog()),defaultRoute:config.defaultRoute,calibration:{store:calibration,sampleRate:0,baselineRoute:config.defaultRoute}});
  let daemon=new KorDaemon({paths,config,store,linear,controller,shipping,port:0,pollIntervalMs:3_600_000});
  let handle=await daemon.start();
  try {
  await wait(()=>daemon.status().runs[0]?.status==='shipping');
  assert.equal((await linear.getIssue(issue.id)).stateId,workflowMappingFixture.running.id);
  await new Promise(r=>setTimeout(r,150));
  assert.equal((await readStatus(paths)).snapshot.runs[0].status,'shipping');
  // Files created after verification stay outside the publication manifest.
  await writeFile(join(cwd,'.env.local'),`token=${secret}\n`);
  await writeFile(join(cwd,'unrelated.txt'),'not part of this change\n');
  const verified=daemon.store.listAssignments()[0].manifest;
  verified.verification.attempts.at(-1).checks.push(...Array.from({length:20},()=>({command:`node hello.js # ${leak}`,exitCode:0,status:'pass',output:`${leak}\n${cwd}\n`+'bounded output '.repeat(2000)})));
  daemon.store.updateShipping(verified);
  await daemon.pollOnce(); // commit and select mode
  assert.equal(daemon.status().runs[0].shipping.stage.kind,mode==='direct'?'publish':'pipeline');
  const committed=(await exec('git',['diff-tree','--no-commit-id','--name-only','-r','HEAD'],{cwd})).stdout.trim().split('\n').sort();
  assert.deepEqual(committed,['feature [literal].txt','hello.js']);
  assert((await exec('git',['status','--porcelain'],{cwd})).stdout.includes('.env.local'));
  assert.equal((await readFile(join(cwd,'.env.local'),'utf8')),`token=${secret}\n`);
  if(mode==='no-mistakes') {
    await daemon.pollOnce(); assert.equal(daemon.status().runs[0].status,'blocked'); assert.equal(starts,1);
    await handle.stop(); daemon=new KorDaemon({paths,config,linear,controller,shipping,port:0,pollIntervalMs:3_600_000});handle=await daemon.start();
    await daemon.pollOnce(); assert.equal(starts,1);assert.equal(launches,1);assert.equal(daemon.status().runs[0].status,'blocked');
    daemonUp=false;await daemon.pollOnce();assert.match(daemon.status().runs[0].shipping.error,/daemon unavailable/);assert.equal(creates,0);
    daemonUp=true;gate=false;published=true;
  }
  await daemon.pollOnce();assert.equal(daemon.status().runs[0].status,'review');
  assert.equal((await linear.getIssue(issue.id)).stateId,workflowMappingFixture.review.id);
  assert.equal((await linear.getIssue(issue.id)).resources.length,1);
  assert(daemon.status().runs[0].shipping.evidence.some(e=>e.id.endsWith('ci-none')&&e.status==='unresolved'));
  await writeFile(join(home,'review-status.json'),JSON.stringify(daemon.status(),null,2));
  const address=handle.server.address();const snapshot=await fetch(`http://127.0.0.1:${address.port}/status`).then(r=>r.json());
  assert.equal(snapshot.snapshot.runs[0].pullRequestUrl,pr().html_url);assert(snapshot.snapshot.runs[0].verification.passed);
  check='failure';await daemon.pollOnce();assert(daemon.status().runs[0].shipping.evidence.some(e=>e.id.includes('ci-check')&&e.status==='fail'));
  check='success';await daemon.pollOnce();assert(daemon.status().runs[0].shipping.evidence.some(e=>e.id.includes('ci-check')&&e.status==='pass'));
  assert.equal(removed,0);
  // A restart in review must not rerun the session, recreate the PR, or lose evidence.
  await handle.stop();daemon=new KorDaemon({paths,config,linear,controller,shipping,port:0,pollIntervalMs:3_600_000});handle=await daemon.start();await daemon.pollOnce();
  assert.equal(daemon.status().runs[0].status,'review');assert.equal(launches,1);assert.equal(creates,mode==='direct'?1:0);
  if(mode==='direct'){
    closed=true;await daemon.pollOnce();assert.equal(daemon.status().runs[0].status,'failed');assert.equal((await linear.getIssue(issue.id)).stateId,workflowMappingFixture.review.id);assert.equal(removed,0);
  } else {
    merged=true;dirty=true;await daemon.pollOnce();assert.equal(daemon.status().runs[0].status,'complete');assert.equal((await linear.getIssue(issue.id)).stateId,workflowMappingFixture.complete.id);assert.equal(removed,0);assert.match(daemon.status().runs[0].shipping.error,/uncommitted/);
    assert.equal(daemon.status().runs[0].shipping.cleanup,'retained');
    await daemon.pollOnce();assert.equal(removed,0);
    const retained=daemon.store.listAssignments()[0].manifest;
    daemon.store.updateShipping({...retained,shipping:{...retained.shipping,cleanup:'pending'}});
    dirty=false;mismatched=true;await daemon.pollOnce();assert.equal(removed,0);assert.match(daemon.status().runs[0].shipping.error,/branch changed/);
    const changed=daemon.store.listAssignments()[0].manifest;
    daemon.store.updateShipping({...changed,shipping:{...changed.shipping,cleanup:'pending'}});
    mismatched=false;await unlink(join(cwd,'.env.local'));await unlink(join(cwd,'unrelated.txt'));await daemon.pollOnce();assert.equal(removed,1);assert.equal(daemon.status().runs[0].shipping.cleanup,'removed');
    await daemon.pollOnce();assert.equal(removed,1);
  }
  assert.equal(calibration.outcomes()[0].status,mode==='direct'?'rejected':'merged');
  assert.equal(calibration.outcomes()[0].source,'shipping.github-observed');
  const final=daemon.status().runs[0];await writeFile(join(home,'status.json'),JSON.stringify(final,null,2));
  await handle.stop();
  console.log(`shipping proof ${mode}: git=committed; Jev=fixture-pass; Linear=${mode==='direct'?'In Review (closed unmerged)':'Done (merge observed)'}; CI=none-unresolved/failure/success; restart=one-session; pipelineStarts=${starts}; PRCreates=${creates}; cleanup=${removed}; status=${final.status}; calibration=${calibration.outcomes()[0].status}`);
  } finally { await handle.stop(); calibration.close(); }
}
console.log('boundaries: git/SQLite/HTTP real; session/Jev/Linear/forge/pipeline/cleanup fixtures; no network or worktree administration');
console.log(`artifacts=${root}`);
// Initial gate failures must never select the direct publishing path.
const sample=JSON.parse(await readFile(join(root,'direct/status.json'),'utf8'));
const execution={id:sample.executionId,issueId:sample.issueId,repository:'LEE',worktree:sample.worktree,branch:sample.branch,status:'shipping',verification:sample.verification,shipping:{stage:{kind:'commit'},evidence:[],cleanup:'pending'}};
for(const failure of ['missing','unavailable','malformed']){
  let publishes=0;
  const driver=new GitHubShipping(async(file,args,cwd)=>{
    if(file==='git'&&args[0]!=='push')return real(file,args,cwd);
    if(file==='no-mistakes')return failure==='missing'?{code:-1,stdout:'',stderr:'ENOENT'}:failure==='unavailable'?{code:1,stdout:encode({error:'dial unix: connection refused'}),stderr:''}:ok('nonsense: true');
    publishes++;throw new Error('unexpected publication');
  });
  const result=await driver.advance({execution,issue:{id:sample.issueId,title:'hello'},repository:{path:sample.worktree,remote:'https://github.com/example/kor-fixture.git',defaultBranch:'main'}});
  assert.equal(result.status,'blocked');assert.equal(publishes,0);assert.equal(result.shipping.stage.kind,'commit');
}
console.log('gate boundaries: missing binary, socket refusal, malformed output => blocked; direct publication calls=0; shipping snapshot readable');

console.log('publication proof: verified files committed; .env.local and unrelated file excluded; PR secrets/local paths redacted; body <= 60000 characters; literal filename preserved');
// Staged and already-committed credentials must fail before any publication call.
let unsafePublications = 0;
const unsafeDriver = new GitHubShipping(async(file, args, cwd) => {
  if (file === 'git' && args[0] !== 'push') return real(file, args, cwd);
  unsafePublications++;
  throw new Error('Unsafe commit reached external publication');
});
const unsafeInput = { execution, issue: { id: sample.issueId, title: 'hello' }, repository: { path: sample.worktree, remote: 'https://github.com/example/kor-fixture.git', defaultBranch: 'main' } };
await writeFile(join(sample.worktree, 'id_helper.ts'), 'export const value = 1;\n');
const excludedInput = structuredClone(unsafeInput);
excludedInput.execution.verification.attempts.at(-1).publication.paths.push('id_helper.ts');
const excluded = await unsafeDriver.advance(excludedInput);
assert.equal(excluded.status, 'blocked');
assert.match(excluded.shipping.error, /id_helper\.ts/);
await unlink(join(sample.worktree, 'id_helper.ts'));
await exec('git', ['add', '--', '.env.local'], { cwd: sample.worktree });
assert.equal((await unsafeDriver.advance(unsafeInput)).status, 'blocked');
await exec('git', ['commit', '-qm', 'fixture: precommitted credential must block publication'], { cwd: sample.worktree });
assert.equal((await unsafeDriver.advance(unsafeInput)).status, 'blocked');
assert.equal(unsafePublications, 0);
console.log('sensitive-path proof: staged and session-committed .env.local blocked before publication');
console.log('excluded-path proof: verified id_helper.ts blocked explicitly before publication');

const renderer = new GitHubShipping(real);
const renderInput = { execution: structuredClone(execution), issue: { id: sample.issueId, title: `fix(shipping): retain evidence.\n${leak}` }, repository: { path: sample.worktree, defaultBranch: 'main' } };
assert.match(renderer.title(renderInput), /^fix\(shipping\): retain evidence/);
assert(!renderer.title(renderInput).includes(secret));assert(!renderer.title(renderInput).includes('\n'));
renderInput.execution.verification.attempts.at(-1).evidence.push({ id: 'screen', kind: 'review', status: 'pass', summary: 'After', source: 'https://example.invalid/after.png' });
renderInput.execution.verification.attempts.at(-1).findings.push({ conditionId: 'manual-browser', status: 'unresolved', evidenceIds: [], note: 'Not checked in a browser' });
const templateDirectory = join(sample.worktree, '.github');
await mkdir(templateDirectory);
const templateFile = join(templateDirectory, 'pull_request_template.md');
await writeFile(templateFile, `## Repository outcome\n\n{{summary}}\n\n## Required checks\n\n{{verification}}\n\n## Captures\n\n{{screenshots}}\n\n## Acceptance\n\n{{checklist}}\n\n- [ ] Maintainer approval\n${leak}\n`);
await exec('git', ['add', '--', '.github/pull_request_template.md'], { cwd: sample.worktree });
await exec('git', ['commit', '-qm', 'fixture: repository PR template'], { cwd: sample.worktree });
const templateHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: sample.worktree })).stdout.trim();
const templateBody = await renderer.body(renderInput, templateHead);
assert.deepEqual(templateBody.match(/^## .+$/gm), ['## Repository outcome', '## Required checks', '## Captures', '## Acceptance']);
assert(templateBody.includes('- [ ] Maintainer approval'));assert(templateBody.includes('- [ ] manual-browser: unresolved; Not checked in a browser'));
assert(templateBody.includes('![After](<https://example.invalid/after.png>)'));assert(!templateBody.includes(secret));assert(!templateBody.includes('/home/fixture'));assert(!templateBody.includes('{{'));
await writeFile(templateFile, '## Uncommitted replacement\n');
assert.equal(await renderer.body(renderInput, templateHead), templateBody);
const literalInput = structuredClone(renderInput);
literalInput.execution.verification.attempts.at(-1).checks[0].output = 'Literal {{checklist}} remains evidence';
assert((await renderer.body(literalInput, templateHead)).includes('Literal {{checklist}} remains evidence'));
await writeFile(join(root, 'template-body.md'), templateBody);
await writeFile(templateFile, '## Custom policy\n\n- [ ] Human checks the client\n');
await exec('git', ['add', '--', '.github/pull_request_template.md'], { cwd: sample.worktree });
await exec('git', ['commit', '-qm', 'fixture: plain repository template'], { cwd: sample.worktree });
const plainBody = await renderer.body(renderInput, (await exec('git', ['rev-parse', 'HEAD'], { cwd: sample.worktree })).stdout.trim());
assert(plainBody.startsWith('## Custom policy\n\n- [ ] Human checks the client\n'));assert(plainBody.includes('Kor execution evidence'));assert(plainBody.includes('node hello.js'));assert(plainBody.includes('- [ ] manual-browser'));
await unlink(templateFile);
await symlink('../README.md', templateFile);
await exec('git', ['add', '--', '.github/pull_request_template.md'], { cwd: sample.worktree });
await exec('git', ['commit', '-qm', 'fixture: symlink template'], { cwd: sample.worktree });
const symlinkBody = await renderer.body(renderInput, (await exec('git', ['rev-parse', 'HEAD'], { cwd: sample.worktree })).stdout.trim());
assert(symlinkBody.startsWith('## What does this PR do?'));
console.log(`PR standard proof: five ordered headings; bounded evidence keeps checklist; conventional titles; committed repository template wins; plain template retains policy; screenshots linked; unresolved checks unticked; template redaction; defaultBytes=${(await readFile(join(root,'direct/pr-body.md'))).length}; templateBytes=${Buffer.byteLength(templateBody)}`);

// Construct the v4 schema directly, independent of git history or a previous dist build.
const migrationFile = join(root, 'migration.db');
const old = new DatabaseSync(migrationFile);
old.exec(`CREATE TABLE assignments (
  issue_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('queued','running','complete','failed','canceled','blocked')), manifest TEXT,
  token TEXT, owner TEXT, expires_at INTEGER, available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  session_pid INTEGER, session_pgid INTEGER, session_boot_id TEXT, session_start_ticks TEXT, heartbeat_at INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0, last_error TEXT, issue_key TEXT, issue_title TEXT
);
CREATE TABLE outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
PRAGMA user_version=4;`);
const expiresAt = Date.now() + 60000;
const manifest = { id: 'migration-execution', issueId: 'migration-issue', repository: 'LEE', worktree: '/tmp/fixture', branch: 'kor/LEE-600', status: 'running' };
old.prepare(`INSERT INTO assignments(issue_id,execution_id,session_id,status,manifest,token,owner,expires_at,available_at,attempts,issue_key,issue_title)
  VALUES(?,?,?,'running',?,?,?,?,?,1,'LEE-600','Migration preservation')`)
  .run(manifest.issueId,manifest.id,'migration-session',JSON.stringify(manifest),'migration-token','old-daemon',expiresAt,Date.now());
old.prepare('INSERT INTO outbox(payload) VALUES(?)').run(JSON.stringify({ kind: 'state', issueId: manifest.issueId, stateId: 'in-progress' }));
old.close();
const migrated = new LinearStore(migrationFile);
const row = migrated.listAssignments()[0];
assert.equal(row.issueKey, 'LEE-600'); assert.equal(row.owner, 'old-daemon'); assert.equal(row.attempts, 1);
assert.deepEqual(row.manifest, manifest); assert.equal(migrated.counts().pendingWrites, 1);
const claim = { assignment: row, token: 'migration-token', owner: 'old-daemon', expiresAt };
migrated.finishClaim(claim, 'shipping', undefined, { ...manifest, status: 'shipping', shipping: { stage: { kind: 'commit' }, evidence: [], cleanup: 'pending' } });
assert.equal(migrated.getAssignment(manifest.issueId).status, 'shipping');
assert.equal(migrated.retry(manifest.issueId), false); assert.equal(migrated.claim('new-daemon'), undefined);
migrated.close();
const migratedDb = new DatabaseSync(migrationFile);
assert.equal(migratedDb.prepare('PRAGMA user_version').get().user_version, 7); migratedDb.close();
console.log('migration proof: v4 -> v7; execution/lease/metadata/outbox preserved; shipping not claimable; retry does not rerun verified work');
