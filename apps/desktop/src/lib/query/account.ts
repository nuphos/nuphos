import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryClient } from './client.ts'
import { queryKeys } from './keys.ts'

/** The member's Personal Credentials. Read again on focus, the fallback when a deep link that
 *  claims a grant never arrives. */
export const personalCredentialsQuery = queryOptions({
  queryKey: queryKeys.personalCredentials(),
  queryFn: () => api.atlasListPersonalCredentials(),
  staleTime: 0,
})

export const usePersonalCredentialsQuery = (enabled = true) =>
  useQuery({ ...personalCredentialsQuery, enabled })

/** After a grant was claimed or dropped, every view showing the credentials reads them again. A
 *  read still in flight started before the change, so it is dropped rather than joined. */
export async function personalCredentialsChanged() {
  const { queryKey } = personalCredentialsQuery

  await queryClient.cancelQueries({ queryKey })
  await queryClient.invalidateQueries({ queryKey })
}

/** The team's own Google OAuth client, which Gmail and Google Drive connect through. */
export const useTeamGoogleClientQuery = (teamId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.teamGoogleClient(teamId ?? ''),
    queryFn: () => api.atlasGetTeamGoogleClient(teamId ?? ''),
    enabled: Boolean(teamId),
  })

/** Where the member is signed in, read again on focus. */
export const useSignInSessionsQuery = () =>
  useQuery({
    queryKey: queryKeys.signInSessions(),
    queryFn: () => api.atlasListSignInSessions(),
    staleTime: 0,
  })

/** What agents ran on this computer, newest first, a page at a time. */
export const deviceAuditQuery = infiniteQueryOptions({
  queryKey: queryKeys.deviceAudit(),
  queryFn: ({ pageParam }) => api.deviceListAudit(pageParam),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (page) => page.nextCursor ?? undefined,
})

export const useDeviceAuditQuery = () => useInfiniteQuery(deviceAuditQuery)
