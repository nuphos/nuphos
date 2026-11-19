import { queryOptions, useQuery } from '@tanstack/react-query'

import { api } from '../api'
import { queryKeys } from '../lib/query/keys'

const NONE: ReadonlySet<string> = new Set()

/** The ids of a team's computers the viewer owns or manages, read once for every view asking. */
export const managedComputersQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.managedComputers(teamId),
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const { devices } = await api.boxListDevices({ teamId })

      return new Set(
        devices
          .filter((device) => device.access === 'manage' || device.access === 'owner')
          .map((device) => device.deviceId),
      )
    },
    staleTime: 60_000,
  })

/**
 * Whether the viewer manages a computer of this team, so signs its agents in themselves
 * (#2431). Empty until it loads or when it fails: they are then asked to ask the owner, as before.
 */
export function useManagedComputers(teamId: string | undefined, enabled = true) {
  const { data } = useQuery({
    ...managedComputersQuery(teamId ?? ''),
    enabled: Boolean(teamId) && enabled,
  })

  return data ?? NONE
}
