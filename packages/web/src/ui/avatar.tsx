// Agent avatars: one Higgsfield loop per agent profile, over a coded glass hexagon.
import * as stylex from '@stylexjs/stylex';
import { Bot, BrainCircuit, CircleCheck, Search } from 'lucide-react';
import { color, tint } from '../theme/tokens.stylex';
import { MotionMedia } from '../motion/MotionMedia';
import { Icon } from './icon';

const styles = stylex.create({
  hex: { width: '100%', height: '100%', display: 'grid', placeItems: 'center', clipPath: 'polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)', backgroundImage: tint.jevCard, color: color.violetBright },
});
const sized = stylex.create({ size: (px: number) => ({ width: `${px}px`, height: `${px}px`, flex: 'none' }) });

export type AgentProfile = 'generalist' | 'specialist' | 'reviewer' | 'jev';
const GLYPH = { generalist: Bot, specialist: Search, reviewer: CircleCheck, jev: BrainCircuit } as const;

export function profileOf(choice: string | undefined, evaluating: boolean): AgentProfile {
  if (evaluating) return 'jev';
  if (choice && /review/i.test(choice)) return 'reviewer';
  if (choice && /special/i.test(choice)) return 'specialist';
  return 'generalist';
}

export function AgentAvatar({ profile, size = 32 }: { profile: AgentProfile; size?: number }) {
  return (
    <MotionMedia slot={`agent-avatar-${profile}`} contain label={`${profile} agent`} style={sized.size(size)}
      fallback={<span {...stylex.props(styles.hex)}><Icon icon={GLYPH[profile]} size={Math.round(size * 0.5)} /></span>} />
  );
}
