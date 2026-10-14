import * as stylex from '@stylexjs/stylex';
import { KeyRound } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { hasToken, setToken } from './api/client';
import { reconnect, useLive } from './api/live';
import { queryClient } from './api/query';
import { useRoute } from './router';
import { closeAsk, useAskState } from './shell/askStore';
import { AskJev } from './shell/AskJev';
import { KorMark } from './shell/Mark';
import { color, font, gradient, space } from './theme/tokens.stylex';
import { Button } from './ui/button';
import { Dialog } from './ui/misc';
import { TextInput } from './ui/form';
import { text } from './ui/text';
import { MotionMedia } from './motion/MotionMedia';
import { CommandCentre } from './screens/CommandCentre';

// Home ships in the first chunk; every other screen loads when first opened.
const ProjectWorkspace = lazy(() => import('./screens/ProjectWorkspace').then(module => ({ default: module.ProjectWorkspace })));
const Agents = lazy(() => import('./screens/Agents').then(module => ({ default: module.Agents })));
const JevDecision = lazy(() => import('./screens/JevDecision').then(module => ({ default: module.JevDecision })));
const ModelsPool = lazy(() => import('./screens/ModelsPool').then(module => ({ default: module.ModelsPool })));
const JevBrain = lazy(() => import('./screens/JevBrain').then(module => ({ default: module.JevBrain })));
const Settings = lazy(() => import('./screens/Settings').then(module => ({ default: module.Settings })));

const styles = stylex.create({
  gate: { position: 'relative', minHeight: '100vh', display: 'grid', placeItems: 'center', backgroundImage: gradient.canvas, backgroundColor: color.canvas, color: color.text, fontFamily: font.sans, isolation: 'isolate', padding: space.s6 },
  splash: { position: 'absolute', inset: 0, zIndex: -1 },
  panel: { width: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: space.s4, alignItems: 'flex-start' },
  title: { fontFamily: font.display, fontSize: '32px', fontWeight: 600, letterSpacing: '-0.015em' },
  body: { color: color.textSecondary, fontSize: '14px', lineHeight: 1.6 },
  code: { fontFamily: font.mono, color: color.cyan },
  full: { width: '100%' },
});

/** Shown when this browser holds no session: open Mission Control with `kor ui`, or paste the token. */
function Connect() {
  const [value, setValue] = useState('');
  const submit = () => { if (!value.trim()) return; setToken(value); void queryClient.invalidateQueries(); reconnect(); window.location.hash = '#/'; };
  return (
    <div {...stylex.props(styles.gate)}>
      <MotionMedia slot="connect-splash" fallback={null} style={styles.splash} />
      <div {...stylex.props(styles.panel)}>
        <KorMark />
        <h1 {...stylex.props(styles.title)}>Connect to <span {...stylex.props(text.grad)}>Kor Code</span></h1>
        <p {...stylex.props(styles.body)}>Mission Control talks only to the Kor daemon on this machine. Run <span {...stylex.props(styles.code)}>kor ui</span> in a terminal; it opens this page already signed in. If the browser opened elsewhere, paste the session token from <span {...stylex.props(styles.code)}>kor ui</span>'s state file below.</p>
        <TextInput label="Session token" icon={KeyRound} type="password" value={value} onChange={setValue} onEnter={submit} placeholder="Session token" mono style={styles.full} />
        <Button variant="primary" onClick={submit} disabled={!value.trim()}>Connect</Button>
      </div>
    </div>
  );
}

function AskOverlay() {
  const ask = useAskState();
  if (!ask.open) return null;
  return (
    <Dialog title="Ask Jev" onClose={closeAsk} wide>
      <AskJev executionId={ask.executionId} initial={ask.prompt} autoFocus />
    </Dialog>
  );
}

function Screen() {
  const route = useRoute();
  switch (route.screen) {
    case 'projects': return <ProjectWorkspace projectId={route.params[0]} tab={route.params[1]} />;
    case 'linear': return <JevDecision executionId={route.params[0]} />;
    case 'agents': return <Agents executionId={route.params[0]} />;
    case 'terminal': return <Agents executionId={route.params[0]} terminal />;
    case 'models': return <ModelsPool />;
    case 'brain': return <JevBrain />;
    case 'settings': return <Settings />;
    default: return <CommandCentre />;
  }
}

export function App() {
  const connection = useLive(live => live.connection);
  if (!hasToken() || connection === 'unauthorized') return <Connect />;
  return <><Suspense fallback={null}><Screen /></Suspense><AskOverlay /></>;
}
