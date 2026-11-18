import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

import type { TeamUsageQuery } from '../../types/usage.ts'

/** The team's token usage for `query`, with the names the viewer may see. The answer names its
 *  query, because the last answer stays on screen while another loads. */
export const useTeamUsageQuery = (teamId: string, query: TeamUsageQuery) =>
  useQuery({
    queryKey: queryKeys.teamUsage(teamId, query),
    queryFn: async () => ({ query, ...(await api.atlasQueryTeamUsage(teamId, query)) }),
    // Read again whenever the section opens, so a turn just finished shows; the last answer stays meanwhile.
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
