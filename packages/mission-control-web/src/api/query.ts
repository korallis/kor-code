import { QueryClient } from '@tanstack/react-query';
import { ApiFailure } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiFailure && (error.code === 'unauthorized' || error.code === 'forbidden' || error.code === 'not_found')) && count < 2,
    },
  },
});
