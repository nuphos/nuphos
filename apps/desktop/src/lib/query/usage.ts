import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

import type { TeamUsageQuery } from '../../types/usage.ts'

const USAGE_STALE_MS = 60_000

/** The team's token usage for `query`; members get only their own conversations'. The answer
 *  names its query, because the last answer stays on screen while another loads. */
export const useTeamUsageQuery = (teamId: string, query: TeamUsageQuery) =>
  useQuery({
    queryKey: queryKeys.teamUsage(teamId, query),
    queryFn: async () => ({ query, rows: (await api.atlasQueryTeamUsage(teamId, query)).rows }),
    staleTime: USAGE_STALE_MS,
    placeholderData: keepPreviousData,
  })
