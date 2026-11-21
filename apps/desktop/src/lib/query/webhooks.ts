import { queryOptions } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

/** A team's outbound webhook endpoints. Administrators only. */
export const webhooksQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.webhooks(teamId),
    queryFn: () => api.atlasListWebhooks(teamId),
    // Deliveries change it in the background, so opening the page reads it again.
    staleTime: 0,
  })
