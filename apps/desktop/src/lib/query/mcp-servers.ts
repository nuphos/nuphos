import { queryOptions } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

/** A team's custom remote MCP servers. Administrators only. */
export const mcpServersQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.mcpServers(teamId),
    queryFn: () => api.atlasListMcpServers(teamId),
    staleTime: 0,
  })
