import * as stylex from '@stylexjs/stylex';
import { useModels, useVerifyModels } from '../api/queries';
import { Button } from '../ui/button';
import { layout } from '../ui/layout';
import { text } from '../ui/text';

/** Shared by the work composer and Models so first-install progress is always visible. */
export function ModelVerification() {
  const models = useModels();
  const verify = useVerifyModels();
  const status = models.data?.verification;
  const verified = models.data?.models.value.filter(model => model.compatibility === 'verified').length ?? 0;
  if (!models.data || verified > 0 && (!status || status.phase === 'idle')) return null;
  const busy = status?.phase === 'selecting' || status?.phase === 'probing';
  return <div {...stylex.props(layout.mt3)} role="status" aria-live="polite">
    <p {...stylex.props(text.muted)}>{verified === 0 ? 'No model is verified yet. Work requests wait here and continue automatically after verification.' : `${verified} models verified.`}</p>
    <p {...stylex.props(text.mono, text.xs, text.muted)}>{status?.phase === 'probing' ? `Verifying ${status.currentModel} · ${status.completed} of ${status.total} checked` : status?.reason ?? 'Preparing automatic model verification…'}</p>
    {status && <p {...stylex.props(text.mono, text.xs, text.muted)}>${status.reservedUsd.toFixed(2)} reserved of ${status.dailyLimitUsd.toFixed(2)} daily probe budget</p>}
    <Button size="sm" busy={verify.isPending} onClick={() => verify.mutate()}>{busy ? 'Verification in progress' : 'Verify models now'}</Button>
    {verify.error && <p {...stylex.props(text.muted)}>{verify.error.message}</p>}
  </div>;
}
