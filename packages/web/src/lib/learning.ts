// Jev's skill learning in words: what outcome learning changed, or how far
// each skill is from the evidence Jev needs before it changes anything.
import type { LearningsReport } from '@kor-code/mission-control';
import { plural } from './format';

export type SkillLearningRow = LearningsReport['skills'][number];
export type LearningStatus = 'hidden' | 'stricter' | 'learning' | 'measuring' | 'old version';

export function learningStatus(skill: SkillLearningRow, report: LearningsReport): LearningStatus {
  if (!skill.current) return 'old version';
  if (skill.samples < report.minimumSamples) return 'measuring';
  const change = report.changes.find(entry => entry.skill === skill.name);
  return change?.kind ?? 'learning';
}

/** One sentence for the Home "Jev learned" panel. */
export function learnedSummary(report: LearningsReport): string {
  const [change] = report.changes;
  if (change) return `${change.skill} ${change.kind === 'hidden' ? 'is hidden from skill picks' : 'gets a stricter bar'}. ${change.reason}`;
  const current = report.skills.filter(skill => skill.current);
  const learning = current.filter(skill => skill.samples >= report.minimumSamples);
  if (learning.length) return `Jev has enough evidence on ${plural(learning.length, 'skill')} and has changed nothing: each was loaded when offered and its confidence matched merge outcomes.`;
  const closest = [...current].sort((a, b) => b.samples - a.samples)[0];
  if (closest) return `Measuring ${plural(current.length, 'skill')}. Jev changes a pick only after ${report.minimumSamples} completed runs offered that skill; ${closest.name} is closest at ${closest.samples}.`;
  return `Nothing learned yet. After ${report.minimumSamples} completed runs offer a skill, Jev hides it if it is never loaded, or raises its bar if its confidence runs ahead of merges.`;
}
