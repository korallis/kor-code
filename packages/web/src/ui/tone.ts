// Tone styles: the coloured text, dim fill and tinted edge every pill, chip and
// feed dot shares. One map, keyed by tone.
import * as stylex from '@stylexjs/stylex';
import type { RunLifecycle } from '@kor-code/core';
import { color, statusTone, tint } from '../theme/tokens.stylex';
import type { Tone } from './text';

export const toneStyles = stylex.create({
  violet: { color: color.violetBright, backgroundColor: color.violetDim, borderColor: tint.violetEdge },
  cyan: { color: color.cyan, backgroundColor: color.cyanDim, borderColor: tint.cyanEdge },
  green: { color: color.green, backgroundColor: color.greenDim, borderColor: tint.greenEdge },
  amber: { color: color.amber, backgroundColor: color.amberDim, borderColor: tint.amberEdge },
  orange: { color: color.orange, backgroundColor: color.orangeDim, borderColor: tint.orangeEdge },
  rose: { color: color.rose, backgroundColor: color.roseDim, borderColor: tint.roseEdge },
  sky: { color: color.sky, backgroundColor: color.skyDim, borderColor: tint.skyEdge },
  magenta: { color: color.magenta, backgroundColor: color.magentaDim, borderColor: tint.magentaEdge },
  slate: { color: color.slate, backgroundColor: color.slateDim, borderColor: tint.slateEdge },
});

export const toneSolid = stylex.create({
  violet: { backgroundColor: color.violetBright },
  cyan: { backgroundColor: color.cyan },
  green: { backgroundColor: color.green },
  amber: { backgroundColor: color.amber },
  orange: { backgroundColor: color.orange },
  rose: { backgroundColor: color.rose },
  sky: { backgroundColor: color.sky },
  magenta: { backgroundColor: color.magenta },
  slate: { backgroundColor: color.slate },
});

/** SVG strokes and gradient stops for charts, from the same tokens. */
export const toneStroke = stylex.create({
  violet: { stroke: color.violetBright, color: color.violetBright },
  cyan: { stroke: color.cyan, color: color.cyan },
  green: { stroke: color.green, color: color.green },
  amber: { stroke: color.amber, color: color.amber },
  orange: { stroke: color.orange, color: color.orange },
  rose: { stroke: color.rose, color: color.rose },
  sky: { stroke: color.sky, color: color.sky },
  magenta: { stroke: color.magenta, color: color.magenta },
  slate: { stroke: color.slate, color: color.slate },
});
export const toneStop = stylex.create({
  violet: { stopColor: color.violetBright },
  cyan: { stopColor: color.cyan },
  green: { stopColor: color.green },
  amber: { stopColor: color.amber },
  orange: { stopColor: color.orange },
  rose: { stopColor: color.rose },
  sky: { stopColor: color.sky },
  magenta: { stopColor: color.magenta },
  slate: { stopColor: color.slate },
});
export const toneFill = stylex.create({
  violet: { fill: color.violetBright },
  cyan: { fill: color.cyan },
  green: { fill: color.green },
  amber: { fill: color.amber },
  orange: { fill: color.orange },
  rose: { fill: color.rose },
  sky: { fill: color.sky },
  magenta: { fill: color.magenta },
  slate: { fill: color.slate },
});

export function toneOf(status: RunLifecycle): Tone {
  return statusTone[status] as Tone;
}

/** Statuses whose dot pulses: something is actively happening. */
export const ACTIVE_STATUSES: ReadonlySet<RunLifecycle> = new Set(['running', 'verifying', 'evaluating', 'repairing', 'shipping']);
