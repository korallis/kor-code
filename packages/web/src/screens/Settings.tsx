// Settings: connect Linear, GitHub, the gateway and Jev (write-only
// credentials), and edit Kor's own configuration, including its projects.
import * as stylex from '@stylexjs/stylex';
import { Check, FolderPlus, KeyRound, Network, Plug, Settings as SettingsIcon, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { KorConfig } from '@kor-code/config';
import type { Connection, ConnectRequest } from '@kor-code/mission-control';
import { ApiFailure } from '../api/client';
import { useConfig, useConnect, useConnections, useSaveConfig } from '../api/queries';
import { href } from '../router';
import { AppFrame } from '../shell/AppFrame';
import { color, font, fontSize, space, tint } from '../theme/tokens.stylex';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { FieldLabel, TextInput } from '../ui/form';
import { BrandMark, Icon } from '../ui/icon';
import { Empty, Notice } from '../ui/misc';
import { Pill } from '../ui/pill';
import { layout } from '../ui/layout';
import { text } from '../ui/text';
import { MotionMedia } from '../motion/MotionMedia';
import { page, QueryError } from './shared';

const styles = stylex.create({
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.s4, alignItems: 'start' },
  connCard: { overflow: 'hidden' },
  splash: { position: 'absolute', inset: 0, opacity: 0.16, pointerEvents: 'none' },
  conn: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) auto', gap: space.s3, alignItems: 'start', paddingBlock: space.s3h, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine, position: 'relative' },
  badge: { width: '36px', height: '36px', borderRadius: '10px', display: 'grid', placeItems: 'center', backgroundColor: tint.ghost, borderWidth: '1px', borderStyle: 'solid', borderColor: color.hairlineStrong, color: color.textSecondary },
  connName: { fontFamily: font.display, fontSize: fontSize.title, fontWeight: 600 },
  fields: { gridColumn: '2 / -1', display: 'grid', gap: space.s2, marginTop: space.s2 },
  form: { display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: '12px 16px', alignItems: 'center' },
  repo: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: space.s2h, alignItems: 'center', paddingBlock: space.s2h, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine },
});

const META: Record<Connection['id'], { title: string; blurb: string }> = {
  linear: { title: 'Linear', blurb: 'Reads issues and writes progress comments with your personal API key.' },
  github: { title: 'GitHub', blurb: 'Opens pull requests and reads their checks.' },
  gateway: { title: 'Gateway', blurb: 'CLIProxyAPI: every model call and the account pool go through it. Kor never edits its config.' },
  jev: { title: 'Jev', blurb: 'The TypeSafe decision service behind readiness, routing and acceptance.' },
};

function ConnectionRow({ connection }: { connection: Connection }) {
  const connect = useConnect();
  const [open, setOpen] = useState(connection.status !== 'connected');
  const [a, setA] = useState(''), [b, setB] = useState(''), [c, setC] = useState('');
  const meta = META[connection.id];
  const glyph = connection.id === 'linear' ? <BrandMark brand="linear" size={17} /> : connection.id === 'github' ? <BrandMark brand="github" size={17} /> : connection.id === 'gateway' ? <Icon icon={Network} size={17} /> : <Icon icon={Sparkles} size={17} />;
  const request = (): ConnectRequest | null => {
    if (connection.id === 'linear') return a.trim() ? { provider: 'linear', apiKey: a.trim() } : null;
    if (connection.id === 'github') return a.trim() ? { provider: 'github', token: a.trim() } : null;
    if (connection.id === 'jev') return a.trim() ? { provider: 'jev', apiKey: a.trim() } : null;
    return a.trim() && b.trim() ? { provider: 'gateway', baseUrl: a.trim(), apiKey: b.trim(), ...(c.trim() ? { managementKey: c.trim() } : {}) } : null;
  };
  const submit = () => { const body = request(); if (body) connect.mutate(body, { onSuccess: () => { setA(''); setB(''); setC(''); } }); };
  return (
    <div {...stylex.props(styles.conn)}>
      <span {...stylex.props(styles.badge)}>{glyph}</span>
      <div>
        <div {...stylex.props(layout.row)}><span {...stylex.props(styles.connName)}>{meta.title}</span><Pill tone={connection.status === 'connected' ? 'green' : 'amber'} small dot>{connection.status}</Pill></div>
        <div {...stylex.props(text.muted, text.sm, layout.mt1)}>{connection.reason ?? meta.blurb}</div>
      </div>
      <Button size="sm" variant={connection.status === 'connected' ? 'ghost' : 'warn'} icon={KeyRound} onClick={() => setOpen(value => !value)}>{connection.status === 'connected' ? 'Replace key' : 'Connect'}</Button>
      {open && (
        <div {...stylex.props(styles.fields)}>
          {connection.id === 'gateway' && <TextInput label="Gateway URL" value={a} onChange={setA} placeholder="http://127.0.0.1:8317" mono />}
          <TextInput label={`${meta.title} key`} type="password" value={connection.id === 'gateway' ? b : a} onChange={connection.id === 'gateway' ? setB : setA} placeholder={connection.id === 'github' ? 'GitHub token' : connection.id === 'gateway' ? 'Gateway API key' : `${meta.title} API key`} mono onEnter={submit} />
          {connection.id === 'gateway' && <TextInput label="Management key" type="password" value={c} onChange={setC} placeholder="Management key (optional, for account health)" mono />}
          {connect.error && <Notice title={connect.error.message} hint={connect.error instanceof ApiFailure ? connect.error.hint : undefined} />}
          {connect.isSuccess && <Notice tone="ok" title="Saved. The key is stored by the daemon and never shown again." />}
          <div {...stylex.props(layout.row)}><span {...stylex.props(text.faint, text.xs)}>Write-only: Kor never sends a credential back to the browser.</span><span {...stylex.props(layout.grow)} /><Button size="sm" variant="primary" icon={Plug} busy={connect.isPending} disabled={!request()} onClick={submit}>Save and test</Button></div>
        </div>
      )}
    </div>
  );
}

function GeneralSettings({ config }: { config: KorConfig }) {
  const save = useSaveConfig();
  const [draft, setDraft] = useState(config);
  const [repoKey, setRepoKey] = useState(''), [repoPath, setRepoPath] = useState(''), [repoTeam, setRepoTeam] = useState('');
  const numberField = (value: string, apply: (n: number) => KorConfig) => { const n = Number(value); if (Number.isInteger(n) && n > 0) setDraft(apply(n)); };
  const addRepo = () => {
    if (!repoKey.trim() || !repoPath.trim()) return;
    setDraft(current => ({ ...current, repos: { ...current.repos, [repoKey.trim()]: { path: repoPath.trim(), defaultBranch: 'main', checks: [], toolAllowlist: [], ship: 'approve', ...(repoTeam.trim() ? { linearTeam: repoTeam.trim() } : {}) } } }));
    setRepoKey(''); setRepoPath(''); setRepoTeam('');
  };
  const removeRepo = (key: string) => setDraft(current => { const repos = { ...current.repos }; delete repos[key]; return { ...current, repos }; });
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  return (
    <>
      <Card index={2}>
        <CardHeader icon={SettingsIcon} title="Kor" />
        <CardBody>
          <div {...stylex.props(styles.form)}>
            <FieldLabel>Intake label</FieldLabel><TextInput label="Intake label" mono value={draft.intakeLabel} onChange={value => setDraft({ ...draft, intakeLabel: value })} />
            <FieldLabel>Poll interval (seconds)</FieldLabel><TextInput label="Poll interval" type="number" mono value={String(draft.pollIntervalSeconds)} onChange={value => numberField(value, n => ({ ...draft, pollIntervalSeconds: n }))} />
            <FieldLabel>Runs at once</FieldLabel><TextInput label="Total runs" type="number" mono value={String(draft.limits.total)} onChange={value => numberField(value, n => ({ ...draft, limits: { ...draft.limits, total: n } }))} />
            <FieldLabel>Runs per repository</FieldLabel><TextInput label="Runs per repository" type="number" mono value={String(draft.limits.perRepository)} onChange={value => numberField(value, n => ({ ...draft, limits: { ...draft.limits, perRepository: n } }))} />
          </div>
        </CardBody>
      </Card>
      <Card index={3}>
        <CardHeader icon={FolderPlus} title="Projects" count={Object.keys(draft.repos).length} />
        <CardBody>
          {Object.entries(draft.repos).map(([key, repo]) => (
            <div key={key} {...stylex.props(styles.repo)}>
              <div><a href={href('projects', key, 'settings')} {...stylex.props(text.strong)}>{key}</a><div {...stylex.props(text.mono, text.xs, text.muted, text.ellipsis)}>{repo.path}{repo.linearTeam ? ` · team ${repo.linearTeam}` : ''}</div></div>
              <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => removeRepo(key)} label={`Remove ${key}`} iconOnly />
            </div>
          ))}
          {Object.keys(draft.repos).length === 0 && <Empty title="No projects yet." />}
          <div {...stylex.props(styles.form, layout.mt4)}>
            <FieldLabel>Key</FieldLabel><TextInput label="Project key" mono value={repoKey} onChange={setRepoKey} placeholder="e.g. matilda-v2" />
            <FieldLabel>Checkout path</FieldLabel><TextInput label="Checkout path" mono value={repoPath} onChange={setRepoPath} placeholder="/home/you/code/project" />
            <FieldLabel>Linear team</FieldLabel><TextInput label="Linear team" mono value={repoTeam} onChange={setRepoTeam} placeholder="e.g. MAT" />
            <span /><div><Button size="sm" icon={FolderPlus} disabled={!repoKey.trim() || !repoPath.trim()} onClick={addRepo}>Add project</Button></div>
          </div>
        </CardBody>
      </Card>
      <div {...stylex.props(layout.stackTight)}>
        {save.error && <Notice title={save.error.message} hint={save.error instanceof ApiFailure ? save.error.hint : undefined} />}
        {save.isSuccess && <Notice tone={save.data.restartRequired ? 'warn' : 'ok'} title={save.data.restartRequired ? 'Saved. Restart the daemon to apply it.' : 'Saved to ~/.config/kor/config.yaml.'} />}
        <div {...stylex.props(layout.row)}><Button variant="primary" icon={Check} busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(draft)}>Save configuration</Button><span {...stylex.props(text.muted, text.sm)}>Validated by the daemon and written atomically, with a backup.</span></div>
      </div>
    </>
  );
}

export function Settings() {
  const connections = useConnections();
  const config = useConfig();
  return (
    <AppFrame active="settings" crumbs={['Settings']}>
      <div {...stylex.props(page.page)}>
        <div><h1 {...stylex.props(page.title)}>Settings</h1><p {...stylex.props(page.lede)}>Connections, projects and limits. Every change goes through the daemon's own validation.</p></div>
        <div {...stylex.props(styles.grid)}>
          <Card index={1} style={styles.connCard} label="Connections">
            <MotionMedia slot="connect-splash" fallback={null} style={styles.splash} />
            <CardHeader icon={Plug} title="Connections" />
            <CardBody>
              {connections.error && <QueryError error={connections.error} what="Connections" />}
              {(connections.data?.connections ?? []).map(connection => <ConnectionRow key={connection.id} connection={connection} />)}
              {connections.isPending && <Empty title="Reading connections…" />}
            </CardBody>
          </Card>
          <div {...stylex.props(layout.stack)}>
            {config.data ? <GeneralSettings key={JSON.stringify(config.data.config)} config={config.data.config} /> : config.error ? <QueryError error={config.error} what="Configuration" /> : <Card pad><Empty title="Reading the configuration…" /></Card>}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
