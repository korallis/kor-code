// Screen 5: every account Kor may use, how Jev routes between them, the
// verified models and when each window resets.
import * as stylex from '@stylexjs/stylex';
import { Check, CircleCheck, CircleX, FlaskConical, KeyRound, Minus, Pause, Plug, Play, Plus, RefreshCw, Route as RouteIcon, Shuffle } from 'lucide-react';
import { useState } from 'react';
import type { KorConfig } from '@kor-code/config';
import type { GatewayAccountHealth } from '@kor-code/core';
import { ApiFailure } from '../api/client';
import { useMissionRuns, usePoolLive } from '../api/data';
import { useAccountPause, useConfig, useModels, useProbe, useSaveConfig } from '../api/queries';
import { navigate } from '../router';
import { AppFrame } from '../shell/AppFrame';
import { color, font, space, tint } from '../theme/tokens.stylex';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Bar, Ring } from '../ui/charts';
import { FieldLabel, Segmented, Select, TextInput, Toggle } from '../ui/form';
import { ProviderBadge, providerKind } from '../ui/glyphs';
import { Icon } from '../ui/icon';
import { Dialog, Empty, Notice } from '../ui/misc';
import { Pill, ProvenanceChip } from '../ui/pill';
import { Table, Td, Th, Tr } from '../ui/table';
import { layout } from '../ui/layout';
import { text, type Tone } from '../ui/text';
import { toneSolid } from '../ui/tone';
import { parseQuota, providerTitle, sessionWindow, weeklyWindow, type QuotaProvider } from '../lib/quota';
import { pct as pctFormat, shortModel } from '../lib/format';
import { keyOf } from '../lib/runs';
import { ago, clock, shortDate, until, useNow } from '../lib/time';
import { page, QueryError } from './shared';

const NARROW = '@media (max-width: 1439px)';

const styles = stylex.create({
  head: { display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' },
  providers: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1.9fr) repeat(3, minmax(0, 1fr))', [NARROW]: 'repeat(2, minmax(0, 1fr))' }, gap: space.s4 },
  provider: { paddingBlock: '16px', paddingInline: '18px', display: 'flex', flexDirection: 'column', gap: '14px' },
  provName: { fontFamily: font.display, fontSize: '17px', fontWeight: 600 },
  dots: { display: 'flex', gap: '4px', marginLeft: 'auto' },
  dot: { width: '9px', height: '9px', borderRadius: '3px' },
  windows: { display: 'flex', gap: '18px', flexWrap: 'wrap' },
  window: { display: 'flex', alignItems: 'center', gap: '10px' },
  wPct: { fontFamily: font.display, fontSize: '19px', fontWeight: 600, lineHeight: 1 },
  wLabel: { fontSize: '11px', color: color.textMuted },
  wReset: { fontFamily: font.mono, fontSize: '10.5px', color: color.textMuted, marginTop: '2px' },
  middle: { display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr) 392px', [NARROW]: 'minmax(0, 1fr) 340px' }, gap: space.s4, alignItems: 'start' },
  tableWrap: { paddingInline: '8px', overflowX: 'auto' },
  barCell: { display: 'grid', gridTemplateColumns: '78px 36px', gap: '8px', alignItems: 'center', fontFamily: font.mono, fontSize: '11px' },
  orbit: { position: 'relative', height: '170px', marginBlock: '4px 12px' },
  core: { position: 'absolute', left: '50%', top: '50%', width: '62px', height: '62px', marginLeft: '-31px', marginTop: '-31px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: font.display, fontWeight: 700, fontSize: '13px', letterSpacing: '.08em', backgroundImage: tint.orbFill, boxShadow: tint.orbGlow, color: tint.white },
  node: { position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontFamily: font.mono, fontSize: '10px', color: color.textMuted, transform: 'translate(-50%, -50%)' },
  ring: { fill: 'none', stroke: tint.violetEdge },
  spoke: { stroke: tint.cyanEdge },
  formGrid: { display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: '12px 12px', alignItems: 'center' },
  limits: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' },
  failover: { display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: '10px', alignItems: 'start', paddingBlock: '10px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tint.rowLine },
});
const nodeAt = stylex.create({ at: (x: number, y: number) => ({ left: `${x}%`, top: `${y}%` }) });
const STATUS_TONE: Record<GatewayAccountHealth['status'], Tone> = { available: 'green', quota: 'amber', authentication: 'rose', unavailable: 'slate', unknown: 'slate' };

function ProviderCard({ provider, accounts, index, now }: { provider: QuotaProvider; accounts: GatewayAccountHealth[]; index: number; now: number }) {
  const five = sessionWindow(provider), week = weeklyWindow(provider);
  const windows = [five, week, ...provider.windows.filter(window => window !== five && window !== week)].filter(Boolean).slice(0, index === 0 ? 3 : 1);
  const available = accounts.filter(account => account.status === 'available').length;
  return (
    <Card index={index} variant={index === 0 ? 'neon' : 'plain'} style={styles.provider} label={providerTitle(provider.provider)}>
      <div {...stylex.props(layout.row)}>
        <ProviderBadge provider={providerKind(provider.provider)} large />
        <div>
          <div {...stylex.props(styles.provName)}>{providerTitle(provider.provider)}</div>
          <div {...stylex.props(text.mono, text.xs, text.muted)}>{provider.plan ?? provider.status ?? ''}{accounts.length ? ` · ${accounts.length} slots · ${available} available` : ''}</div>
        </div>
        <span {...stylex.props(styles.dots)}>{accounts.map(account => <i key={account.id} title={`${account.id}: ${account.status}`} {...stylex.props(styles.dot, toneSolid[STATUS_TONE[account.status]])} />)}</span>
      </div>
      <div {...stylex.props(styles.windows)}>
        {windows.map(window => window && (
          <div key={window.id} {...stylex.props(styles.window)}>
            <Ring pct={window.percentRemaining ?? 0} size={42} stroke={5} from={(window.percentRemaining ?? 100) < 30 ? 'amber' : 'violet'} to={(window.percentRemaining ?? 100) < 30 ? 'amber' : 'cyan'} label={`${window.label} remaining`} />
            <div>
              <div {...stylex.props(styles.wPct)}>{window.percentRemaining != null ? `${Math.round(window.percentRemaining)}%` : window.remainingCredits != null ? window.remainingCredits : '—'}</div>
              <div {...stylex.props(styles.wLabel)}>{window.label}</div>
              {window.resetsAt && <div {...stylex.props(styles.wReset)}>{window.kind === 'session' ? `resets ${clock(window.resetsAt)} · ${until(window.resetsAt, now)}` : shortDate(window.resetsAt)}</div>}
            </div>
          </div>
        ))}
        {windows.length === 0 && <ProvenanceChip provenance="unavailable" reason={provider.status ?? undefined}>{provider.notSetUp ? 'not set up' : 'no windows reported'}</ProvenanceChip>}
      </div>
    </Card>
  );
}

function RoutingCard({ config, runs }: { config: KorConfig; runs: ReturnType<typeof useMissionRuns>['runs'] }) {
  const save = useSaveConfig();
  const models = useModels();
  const [draft, setDraft] = useState(config);
  const verified = (models.data?.models.value ?? []).filter(model => model.compatibility === 'verified').map(model => model.id);
  const modelOptions = [...new Set([draft.defaultRoute.model, ...verified])].map(value => ({ value, label: value }));
  const byProvider = new Map<string, number>();
  for (const run of runs) if (run.route) byProvider.set(run.route.provider, (byProvider.get(run.route.provider) ?? 0) + 1);
  const total = [...byProvider.values()].reduce((a, b) => a + b, 0);
  const nodes = [...byProvider].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const positions = [[16, 22], [84, 22], [24, 82], [76, 82]] as const;
  const route = (patch: Partial<KorConfig['defaultRoute']>) => setDraft(current => ({ ...current, defaultRoute: { ...current.defaultRoute, ...patch } }));
  const limit = (key: 'total' | 'perRepository' | 'perProvider') => (value: string) => setDraft(current => {
    const n = Number(value);
    const limits = { ...current.limits } as KorConfig['limits'];
    if (key === 'perProvider' && (!value || !Number.isFinite(n) || n <= 0)) delete limits.perProvider;
    else if (Number.isInteger(n) && n > 0) limits[key] = n;
    return { ...current, limits };
  });
  return (
    <Card index={6} label="Routing">
      <CardHeader icon={Shuffle} title="Routing" aside={<Pill tone="violet" small dot>Jev decides</Pill>} />
      <CardBody>
        <div {...stylex.props(styles.orbit)} aria-label="Runs by provider">
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx="50" cy="52" rx="44" ry="36" strokeWidth=".6" strokeDasharray="1.5 1.5" {...stylex.props(styles.ring)} />
            {nodes.map(([name], i) => <line key={name} x1="50" y1="52" x2={positions[i]![0]} y2={positions[i]![1]} strokeWidth=".5" {...stylex.props(styles.spoke)} />)}
          </svg>
          <span {...stylex.props(styles.core)}>JEV</span>
          {nodes.map(([name, count], i) => (
            <span key={name} {...stylex.props(styles.node, nodeAt.at(positions[i]![0], positions[i]![1]))}>
              <span>{providerTitle(name.replace('anthropic', 'claude')).toLowerCase()} {total ? Math.round((count / total) * 100) : 0}%</span>
              <ProviderBadge provider={providerKind(name)} />
            </span>
          ))}
          {nodes.length === 0 && <span {...stylex.props(styles.node, nodeAt.at(50, 92))}>no routed runs yet</span>}
        </div>
        <div {...stylex.props(styles.formGrid)}>
          <FieldLabel>Account policy</FieldLabel>
          <Segmented label="Account policy" value={draft.defaultRoute.accountPolicy} onChange={value => route({ accountPolicy: value })} options={[{ value: 'fill-first', label: 'fill-first' }, { value: 'least-used', label: 'least-used' }, { value: 'manual', label: 'manual' }]} />
          <FieldLabel>Session affinity</FieldLabel>
          <Toggle on={draft.defaultRoute.sessionAffinity} onChange={value => route({ sessionAffinity: value })} label="Session affinity"><span {...stylex.props(text.mono, text.xs, text.muted)}>keep a run on one slot</span></Toggle>
          <FieldLabel>Default route</FieldLabel>
          <div {...stylex.props(layout.row)}>
            <Select label="Default model" value={draft.defaultRoute.model} onChange={value => route({ model: value })} options={modelOptions} style={layout.grow} />
            <Select label="Reasoning level" value={draft.defaultRoute.reasoningLevel} onChange={value => route({ reasoningLevel: value })} options={[{ value: 'low', label: 'low' }, { value: 'medium', label: 'medium' }, { value: 'high', label: 'high' }]} />
          </div>
          <FieldLabel>Limits</FieldLabel>
          <div {...stylex.props(styles.limits)}>
            <TextInput label="Total runs" type="number" mono value={String(draft.limits.total)} onChange={limit('total')} trailing={<span {...stylex.props(text.muted, text.xs)}>total</span>} />
            <TextInput label="Per repository" type="number" mono value={String(draft.limits.perRepository)} onChange={limit('perRepository')} trailing={<span {...stylex.props(text.muted, text.xs)}>/ repo</span>} />
            <TextInput label="Per provider" type="number" mono value={draft.limits.perProvider ? String(draft.limits.perProvider) : ''} onChange={limit('perProvider')} placeholder="–" trailing={<span {...stylex.props(text.muted, text.xs)}>/ prov</span>} />
          </div>
          <FieldLabel>Calibration</FieldLabel>
          <div {...stylex.props(layout.row)}>
            <Toggle on={draft.calibration.sampleRate > 0} onChange={on => setDraft(current => ({ ...current, calibration: { ...current.calibration, sampleRate: on ? (config.calibration.sampleRate || 0.25) : 0 } }))} label="Calibration sampling" />
            <span {...stylex.props(text.mono, text.xs, text.muted)}>{Math.round(draft.calibration.sampleRate * 100)}% paired with baseline</span>
          </div>
        </div>
        {save.error && <div {...stylex.props(layout.mt3)}><Notice title={save.error.message} hint={save.error instanceof ApiFailure ? save.error.hint : undefined} /></div>}
        {save.isSuccess && <div {...stylex.props(layout.mt3)}><Notice tone={save.data.restartRequired ? 'warn' : 'ok'} title={save.data.restartRequired ? 'Saved. Restart the daemon to apply it.' : 'Routing saved.'} /></div>}
        <div {...stylex.props(layout.row, layout.mt4)}>
          <span {...stylex.props(text.mono, text.xs, text.muted)}>writes ~/.config/kor/config.yaml</span>
          <span {...stylex.props(layout.grow)} />
          <Button variant="primary" size="sm" icon={Check} busy={save.isPending} onClick={() => save.mutate(draft)}>Save routing</Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function ModelsPool() {
  const now = useNow();
  const pool = usePoolLive();
  const models = useModels();
  const config = useConfig();
  const { runs } = useMissionRuns();
  const pause = useAccountPause();
  const probe = useProbe();
  const [probing, setProbing] = useState(false);
  const accounts = pool.accounts?.value ?? [];
  const quota = parseQuota(pool.quota?.value ?? null).filter(provider => !provider.notSetUp);
  const accountsFor = (provider: string) => accounts.filter(account => providerKind(account.provider ?? account.id) === providerKind(provider));
  const modelList = models.data?.models.value ?? [];
  const runsByModel = new Map<string, { runs: number; verified: number }>();
  for (const run of runs) if (run.route) { const entry = runsByModel.get(run.route.model) ?? { runs: 0, verified: 0 }; entry.runs += 1; if (run.verification?.passed) entry.verified += 1; runsByModel.set(run.route.model, entry); }
  const verifiedCount = modelList.filter(model => model.compatibility === 'verified').length;
  const error = pause.error ?? probe.error;
  return (
    <AppFrame active="models" crumbs={['Models', 'Subscription pool']} askHint={'Ask Jev — "move a project off one slot", "what if Codex runs out?"'}>
      <div {...stylex.props(page.page)}>
        <header {...stylex.props(styles.head)}>
          <div>
            <h1 {...stylex.props(page.title)}>Models and accounts</h1>
            <p {...stylex.props(page.lede)}>Every account Kor may use, how Jev routes between them, and when each window resets.</p>
          </div>
          <span {...stylex.props(layout.grow)} />
          {pool.accounts && <ProvenanceChip provenance={pool.accounts.provenance} reason={pool.accounts.reason}>{pool.accounts.provenance} · gateway {ago(pool.accounts.observedAt, now)}</ProvenanceChip>}
          {pool.quota && <ProvenanceChip provenance={pool.quota.provenance} reason={pool.quota.reason}>{pool.quota.provenance} · quota-axi {ago(pool.quota.observedAt, now)}</ProvenanceChip>}
          <Button icon={Plug} onClick={() => navigate('settings')}>Connect account</Button>
          <Button variant="primary" icon={FlaskConical} onClick={() => setProbing(true)}>Probe a model</Button>
        </header>
        {pool.error && <QueryError error={pool.error} what="The account pool" />}
        {error && <Notice title={error.message} hint={error instanceof ApiFailure ? error.hint : undefined} />}
        {probe.isSuccess && <Notice tone={probe.data.verified ? 'ok' : 'warn'} title={`${probe.data.model} ${probe.data.verified ? 'passed every probe and is verified for routing.' : 'did not pass every probe; Kor will not route to it.'}`} />}
        <section {...stylex.props(styles.providers)}>
          {quota.map((provider, index) => <ProviderCard key={provider.provider} provider={provider} accounts={accountsFor(provider.provider)} index={index} now={now} />)}
          {quota.length === 0 && <Card pad><Empty slot="empty-pool-unavailable" title="No quota windows reported.">{pool.quota?.reason ?? 'quota-axi has not answered the daemon yet.'}</Empty></Card>}
        </section>
        <div {...stylex.props(styles.middle)}>
          <div {...stylex.props(layout.stack)}>
            <Card index={5} clip label="Account slots">
              <CardHeader icon={KeyRound} title="Account slots" count={accounts.length} aside={<span {...stylex.props(text.mono, text.xs, text.muted)}>health from the gateway · windows from quota-axi</span>} />
              <div {...stylex.props(styles.tableWrap)}>
                <Table label="Account slots">
                  <thead><tr><Th>Slot</Th><Th>Health</Th><Th>Remaining</Th><Th>In use by</Th><Th>Resets</Th><Th /></tr></thead>
                  <tbody>
                    {accounts.map(account => {
                      const user = runs.find(run => run.accountSlot.value === account.id && !['complete', 'failed', 'canceled'].includes(run.status));
                      return (
                        <Tr key={account.id}>
                          <Td><span {...stylex.props(layout.row)}><ProviderBadge provider={providerKind(account.provider ?? account.id)} /><span {...stylex.props(text.mono)}>{account.id}</span></span></Td>
                          <Td><Pill tone={STATUS_TONE[account.status]} small dot>{account.status}</Pill></Td>
                          <Td>{account.remainingQuota !== undefined ? <span {...stylex.props(styles.barCell)}><Bar pct={account.remainingQuota <= 1 ? account.remainingQuota * 100 : account.remainingQuota} size="thin" tone={account.remainingQuota < 0.3 ? 'amber' : 'brand'} /><span>{account.remainingQuota <= 1 ? pctFormat(account.remainingQuota) : `${Math.round(account.remainingQuota)}%`}</span></span> : <span {...stylex.props(text.faint, text.mono, text.xs)}>not reported</span>}</Td>
                          <Td>{user ? <span {...stylex.props(layout.row)}><span {...stylex.props(text.key)}>{keyOf(user)}</span><span {...stylex.props(text.mono, text.xs)}>{shortModel(user.route?.model)}</span></span> : <span {...stylex.props(text.muted, text.mono, text.xs)}>{account.status === 'authentication' ? 'excluded' : 'idle'}</span>}</Td>
                          <Td><span {...stylex.props(text.mono, text.xs, account.status === 'quota' ? text.amber : text.muted)}>{account.resetAt ? `${clock(account.resetAt)} · in ${until(account.resetAt, now)}` : '—'}</span></Td>
                          <Td align="right">
                            {account.status === 'authentication'
                              ? <Button size="sm" variant="warn" onClick={() => navigate('settings')}>Re-auth</Button>
                              : <span {...stylex.props(layout.row)}>
                                  <Button size="sm" variant="ghost" icon={Pause} busy={pause.isPending && pause.variables?.accountId === account.id && pause.variables.paused} onClick={() => pause.mutate({ accountId: account.id, paused: true })}>Pause</Button>
                                  <Button size="sm" variant="ghost" icon={Play} busy={pause.isPending && pause.variables?.accountId === account.id && !pause.variables.paused} onClick={() => pause.mutate({ accountId: account.id, paused: false })} label={`Resume ${account.id}`} iconOnly />
                                </span>}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
                {accounts.length === 0 && <Empty slot="empty-pool-unavailable" title={pool.accounts?.reason ?? 'The gateway reported no accounts.'} />}
              </div>
              <CardBody><div {...stylex.props(layout.row, layout.mt3)}><Button size="sm" icon={Plus} onClick={() => navigate('settings')}>Connect another account</Button><span {...stylex.props(text.mono, text.xs, text.muted)}>through the gateway connection · Kor never edits the proxy config</span></div></CardBody>
            </Card>
            <Card index={7} clip label="Verified models">
              <CardHeader icon={FlaskConical} title="Verified models" count={`${verifiedCount} of ${modelList.length}`} aside={<span {...stylex.props(text.mono, text.xs, text.muted)}>Kor routes only to models that pass all four probes</span>} />
              <div {...stylex.props(styles.tableWrap)}>
                <Table label="Verified models">
                  <thead><tr><Th>Model</Th><Th align="center">Streaming</Th><Th align="center">Tool calls</Th><Th align="center">Thinking</Th><Th align="center">Structured</Th><Th align="right">Runs</Th><Th align="right">Verified</Th><Th /></tr></thead>
                  <tbody>
                    {modelList.map(model => {
                      const usage = runsByModel.get(model.id);
                      const cap = (name: 'streaming' | 'tool_calls' | 'thinking' | 'structured_output') => model.capabilities[name] === true ? <Icon icon={CircleCheck} size={14} style={text.green} /> : model.capabilities[name] === false ? <Icon icon={CircleX} size={14} style={text.rose} /> : <Icon icon={Minus} size={14} style={text.faint} />;
                      return (
                        <Tr key={model.id}>
                          <Td><span {...stylex.props(layout.row)}><ProviderBadge provider={providerKind(model.provider ?? model.id)} /><span {...stylex.props(text.mono)}>{model.id}</span></span></Td>
                          <Td align="center">{cap('streaming')}</Td><Td align="center">{cap('tool_calls')}</Td><Td align="center">{cap('thinking')}</Td><Td align="center">{cap('structured_output')}</Td>
                          <Td align="right"><span {...stylex.props(text.mono)}>{usage?.runs ?? 0}</span></Td>
                          <Td align="right">{model.compatibility === 'incompatible' ? <Pill tone="rose" small>incompatible</Pill> : model.compatibility === 'unverified' ? <Pill tone="slate" small>unverified</Pill> : <span {...stylex.props(text.mono, text.green)}>{usage?.runs ? pctFormat(usage.verified / usage.runs) : 'verified'}</span>}</Td>
                          <Td align="right"><Button size="sm" variant="ghost" icon={RefreshCw} busy={probe.isPending && probe.variables === model.id} onClick={() => probe.mutate(model.id)}>Probe</Button></Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
                {models.error && <CardBody><QueryError error={models.error} what="Models" /></CardBody>}
              </div>
            </Card>
          </div>
          <div {...stylex.props(layout.stack)}>
            {config.data ? <RoutingCard key={JSON.stringify(config.data.config)} config={config.data.config} runs={runs} /> : config.error ? <QueryError error={config.error} what="Configuration" /> : <Card pad><Empty title="Reading the configuration…" /></Card>}
            <Card index={8}>
              <CardHeader icon={RouteIcon} title="Accounts needing attention" count={accounts.filter(account => account.status !== 'available').length} />
              <CardBody>
                {accounts.filter(account => account.status !== 'available').map(account => (
                  <div key={account.id} {...stylex.props(styles.failover)}>
                    <ProviderBadge provider={providerKind(account.provider ?? account.id)} />
                    <div><b {...stylex.props(text.strong, text.mono)}>{account.id}</b> <span {...stylex.props(text.secondary)}>{account.status === 'quota' ? 'out of quota' : account.status === 'authentication' ? 'needs re-authentication' : account.status}</span><div {...stylex.props(text.mono, text.xs, text.muted)}>{account.resetAt ? `back at ${clock(account.resetAt)}` : account.status === 'authentication' ? 'excluded from the pool until re-auth' : 'health unknown'}</div></div>
                    <Pill tone={STATUS_TONE[account.status]} small>{account.status}</Pill>
                  </div>
                ))}
                {accounts.length > 0 && accounts.every(account => account.status === 'available') && <span {...stylex.props(text.muted)}>Every account is available.</span>}
                <div {...stylex.props(layout.mt3)}><ProvenanceChip provenance="unavailable" reason="The daemon does not yet report per-request failover telemetry">failover history not reported</ProvenanceChip></div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
      {probing && (
        <ProbeDialog models={modelList.map(model => model.id)} onClose={() => setProbing(false)} onProbe={model => { probe.mutate(model); setProbing(false); }} />
      )}
    </AppFrame>
  );
}

function ProbeDialog({ models, onClose, onProbe }: { models: string[]; onClose: () => void; onProbe: (model: string) => void }) {
  const [model, setModel] = useState(models[0] ?? '');
  const [custom, setCustom] = useState('');
  return (
    <Dialog title="Probe a model" onClose={onClose} icon={<FlaskConical size={18} />}>
      <p {...stylex.props(text.secondary)}>Kor sends the four probes (streaming, tool calls, thinking, structured output) through the gateway. Only a model that passes all four is routed to.</p>
      {models.length > 0 && <Select label="Model" value={model} onChange={setModel} options={models.map(value => ({ value, label: value }))} />}
      <TextInput label="Or another model ID" value={custom} onChange={setCustom} placeholder="model ID the gateway serves" mono />
      <div {...stylex.props(layout.row)}><span {...stylex.props(layout.grow)} /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={FlaskConical} disabled={!(custom.trim() || model)} onClick={() => onProbe(custom.trim() || model)}>Run probes</Button></div>
    </Dialog>
  );
}

