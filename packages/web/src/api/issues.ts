// Linear issues for every configured project, one cached query each.
import { useQueries } from '@tanstack/react-query';
import type { LinearIssue } from '@kor-code/linear';
import type { Project } from '@kor-code/mission-control';
import type { Provenance } from '@kor-code/core';
import { get, path } from './client';

export interface ProjectIssues { project: Project; issues: LinearIssue[]; provenance: Provenance | 'loading'; reason?: string | undefined; observedAt?: string | undefined }

export function issuesQuery(project: string) {
  return { queryKey: ['issues', project], staleTime: 60_000, queryFn: () => get('GET /api/linear/issues', path('GET /api/linear/issues', '/api/linear/issues', {}, { project })) };
}
export function pullsQuery(repo: string) {
  return { queryKey: ['pulls', repo], staleTime: 60_000, queryFn: () => get('GET /api/github/pulls', path('GET /api/github/pulls', '/api/github/pulls', {}, { repo })) };
}

export function useAllIssues(projects: readonly Project[]): ProjectIssues[] {
  const results = useQueries({ queries: projects.map(project => issuesQuery(project.id)) });
  return projects.map((project, index) => {
    const result = results[index];
    const data = result?.data;
    if (!data) return { project, issues: [], provenance: result?.isError ? 'unavailable' : 'loading', reason: result?.error?.message };
    return { project, issues: data.issues.value, provenance: data.issues.provenance, reason: data.issues.reason, observedAt: data.issues.observedAt };
  });
}

export function useAllPulls(projects: readonly Project[]) {
  const results = useQueries({ queries: projects.map(project => pullsQuery(project.id)) });
  return projects.map((project, index) => ({ project, pulls: results[index]?.data?.pulls ?? null, error: results[index]?.error ?? null }));
}

/** Issues Kor may start: labelled with the intake label, not started, with no run yet. */
export function isOpen(issue: LinearIssue): boolean { return issue.stateType !== 'completed' && issue.stateType !== 'canceled' && issue.stateType !== 'duplicate'; }
export function issueKey(issue: LinearIssue): string { return issue.identifier ?? issue.id.slice(0, 8); }
