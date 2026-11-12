import { QueryClient } from '@tanstack/react-query'

import { isAccountGone, isSessionRejected, parseAtlasError } from '../../api/errors.ts'

const TIMEOUT = /timeout|timed out/i

/** Only a read that never got an answer is worth one more try. The main process already retries
 *  quick connection failures, a timeout would wait on the same dead connection, and a refusal the
 *  backend wrote (it carries a code) answers the same way again. */
export function retryRead(failures: number, error: unknown): boolean {
  if (failures >= 1) return false
  if (isSessionRejected(error) || isAccountGone(error)) return false
  const parsed = parseAtlasError(error)

  return parsed.code === undefined && !TIMEOUT.test(parsed.message)
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // A hidden window does not poll; focus and visibility refresh what went stale meanwhile.
      queries: {
        retry: retryRead,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
      },
      // A write is never sent twice on its own.
      mutations: { retry: false },
    },
  })
}

export const queryClient = createQueryClient()
