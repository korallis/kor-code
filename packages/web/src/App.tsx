import { Card, CardHeader } from './ui/card';
import { StatusPill } from './ui/pill';
import { StageTrack } from './ui/stages';
import { Button } from './ui/button';
import { JevOrb } from './ui/orb';
import { Bar, Ring, Spark } from './ui/charts';
export function App() {
  return <Card pad><CardHeader title="Test" /><StatusPill status="running" /><StageTrack stage="execute" status="running" labels /><Button variant="primary">Go</Button><JevOrb /><Bar pct={50} /><Ring pct={70} label="r" /><Spark values={[1,2,3,2]} tone="cyan" label="s" /></Card>;
}
