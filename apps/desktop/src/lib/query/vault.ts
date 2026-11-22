import { queryOptions } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

/**
 * The vault's devices, and which one is this app. Polled while this app waits for approval:
 * that happens on another device, so nothing here would refresh the screen.
 */
export const vaultStatusQuery = (userId: string) =>
  queryOptions({
    queryKey: queryKeys.vault(userId),
    queryFn: () => api.vaultStatus(),
    refetchInterval: ({ state: { data } }) =>
      data?.devices.some((d) => d.id === data.thisDeviceId && d.state === 'pending')
        ? 3_000
        : false,
  })

/** The item names; values are read one at a time when asked for. */
export const vaultItemsQuery = (userId: string) =>
  queryOptions({ queryKey: queryKeys.vaultItems(userId), queryFn: () => api.vaultItems() })
