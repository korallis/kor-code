// Reads: one react-query hook per daemon endpoint. Writes: one mutation per
// action, each invalidating what it changes. Every value the screens show
// comes through here or the live store.
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ConnectRequest, MessageRequest, OverrideRequest, QueueRequest, SuggestedAction } from '@kor-code/mission-control';
import type { KorConfig } from '@kor-code/config';
import { get, path, post, put } from './client';
import { queryClient } from './query';

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => get('GET /api/status', path('GET /api/status', '/api/status')) });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => get('GET /api/projects', path('GET /api/projects', '/api/projects')) });
export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: () => get('GET /api/runs', path('GET /api/runs', '/api/runs')) });
export const useRun = (id: string | undefined) => useQuery({ queryKey: ['run', id], enabled: id !== undefined, queryFn: () => get('GET /api/runs/:id', path('GET /api/runs/:id', '/api/runs/:id', { id: id ?? '' })) });
export const useTerminal = (id: string | undefined) => useQuery({ queryKey: ['terminal', id], enabled: id !== undefined, staleTime: Infinity, queryFn: () => get('GET /api/runs/:id/terminal', path('GET /api/runs/:id/terminal', '/api/runs/:id/terminal', { id: id ?? '' })) });
export const useIssues = (project: string | undefined) => useQuery({ queryKey: ['issues', project], enabled: project !== undefined, staleTime: 60_000, queryFn: () => get('GET /api/issues', path('GET /api/issues', '/api/issues', {}, { project: project ?? '' })) });
export const useIssue = (id: string | undefined) => useQuery({ queryKey: ['issue', id], enabled: id !== undefined, staleTime: 60_000, refetchInterval: 60_000, queryFn: () => get('GET /api/issues/:id', path('GET /api/issues/:id', '/api/issues/:id', { id: id ?? '' })) });
export const useProjectDocuments = (project: string | undefined, enabled: boolean) => useQuery({ queryKey: ['documents', project], enabled: enabled && project !== undefined, staleTime: 60_000, refetchInterval: 60_000, queryFn: () => get('GET /api/documents', path('GET /api/documents', '/api/documents', {}, { project: project ?? '' })) });
export const usePulls = (repo: string | undefined) => useQuery({ queryKey: ['pulls', repo], enabled: repo !== undefined, staleTime: 60_000, queryFn: () => get('GET /api/github/pulls', path('GET /api/github/pulls', '/api/github/pulls', {}, { repo: repo ?? '' })) });
export const useModels = () => useQuery({ queryKey: ['models'], staleTime: 60_000, refetchInterval: 60_000, queryFn: () => get('GET /api/models', path('GET /api/models', '/api/models')) });
export const usePool = () => useQuery({ queryKey: ['pool'], refetchInterval: 60_000, queryFn: () => get('GET /api/pool', path('GET /api/pool', '/api/pool')) });
export const useBrain = () => useQuery({ queryKey: ['brain'], staleTime: 60_000, queryFn: () => get('GET /api/brain', path('GET /api/brain', '/api/brain')) });
export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => get('GET /api/config', path('GET /api/config', '/api/config')) });
export const useSessionPack = (id: string) => useQuery({ queryKey: ['session', id], queryFn: () => get('GET /api/runs/:id/session', path('GET /api/runs/:id/session', '/api/runs/:id/session', { id })) });
export const useConnections = () => useQuery({ queryKey: ['connections'], refetchInterval: 60_000, queryFn: () => get('GET /api/connections', path('GET /api/connections', '/api/connections')) });

const refresh = (...keys: string[][]) => Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey })));

export function useQueue() {
  return useMutation({ mutationFn: (body: QueueRequest) => post('POST /api/runs', '/api/runs', body), onSuccess: () => refresh(['runs'], ['projects'], ['issues']) });
}

type RunAction = 'cancel' | 'retry' | 'approve';
export function useRunAction() {
  return useMutation({
    mutationFn: ({ action, executionId }: { action: RunAction; executionId: string }) => {
      if (action === 'cancel') return post('POST /api/runs/:id/cancel', path('POST /api/runs/:id/cancel', '/api/runs/:id/cancel', { id: executionId }), {});
      if (action === 'retry') return post('POST /api/runs/:id/retry', path('POST /api/runs/:id/retry', '/api/runs/:id/retry', { id: executionId }), {});
      return post('POST /api/runs/:id/approve', path('POST /api/runs/:id/approve', '/api/runs/:id/approve', { id: executionId }), {});
    },
    onSuccess: (_, { executionId }) => refresh(['runs'], ['run', executionId], ['projects']),
  });
}

type MessageAction = 'answer' | 'request-changes' | 'note';
export function useRunMessage() {
  return useMutation({
    mutationFn: ({ action, executionId, body }: { action: MessageAction; executionId: string; body: MessageRequest }) => {
      if (action === 'answer') return post('POST /api/runs/:id/answer', path('POST /api/runs/:id/answer', '/api/runs/:id/answer', { id: executionId }), body);
      if (action === 'request-changes') return post('POST /api/runs/:id/request-changes', path('POST /api/runs/:id/request-changes', '/api/runs/:id/request-changes', { id: executionId }), body);
      return post('POST /api/runs/:id/note', path('POST /api/runs/:id/note', '/api/runs/:id/note', { id: executionId }), body);
    },
    onSuccess: (_, { executionId }) => refresh(['runs'], ['run', executionId]),
  });
}

export function useOverride() {
  return useMutation({ mutationFn: (body: OverrideRequest) => post('POST /api/overrides', '/api/overrides', body), onSuccess: () => refresh(['runs'], ['status'], ['brain'], ['session']) });
}
export function useRevertOverride() {
  return useMutation({ mutationFn: (id: string) => post('POST /api/overrides/:id/revert', path('POST /api/overrides/:id/revert', '/api/overrides/:id/revert', { id }), {}), onSuccess: () => refresh(['runs'], ['status'], ['brain'], ['session']) });
}

export function useAsk() {
  return useMutation({ mutationFn: (body: { message: string; executionId?: string; requestId?: string }) => post('POST /api/ask', '/api/ask', body), onSuccess: () => refresh(['runs'], ['status'], ['brain'], ['issues']) });
}

export function useSaveConfig() {
  return useMutation({ mutationFn: (config: KorConfig) => put('PUT /api/config', '/api/config', config), onSuccess: () => refresh(['config'], ['projects']) });
}
export function useSaveProject() {
  return useMutation({
    mutationFn: ({ project, repository }: { project: string; repository: KorConfig['repos'][string] }) => put('PUT /api/projects/:project', path('PUT /api/projects/:project', '/api/projects/:project', { project }), repository),
    onSuccess: () => refresh(['config'], ['projects']),
  });
}
export function useProbe() {
  return useMutation({ mutationFn: (model: string) => post('POST /api/models/:id/probe', path('POST /api/models/:id/probe', '/api/models/:id/probe', { id: model }), {}), onSuccess: () => refresh(['models']) });
}
export function useAccountPause() {
  return useMutation({
    mutationFn: ({ accountId, paused }: { accountId: string; paused: boolean }) => paused
      ? post('POST /api/accounts/:id/pause', path('POST /api/accounts/:id/pause', '/api/accounts/:id/pause', { id: accountId }), {})
      : post('POST /api/accounts/:id/resume', path('POST /api/accounts/:id/resume', '/api/accounts/:id/resume', { id: accountId }), {}),
    onSuccess: () => refresh(['pool']),
  });
}
export function useConnect() {
  return useMutation({ mutationFn: (body: ConnectRequest) => post('POST /api/connections', '/api/connections', body), onSuccess: () => refresh(['connections']) });
}

export type { SuggestedAction };
