import { queryOptions } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

/** The vault's devices, and which one is this app. */
export const vaultStatusQuery = (userId: string) =>
  queryOptions({ queryKey: queryKeys.vault(userId), queryFn: () => api.vaultStatus() })

/** The item names; values are read one at a time when asked for. */
export const vaultItemsQuery = (userId: string) =>
  queryOptions({ queryKey: queryKeys.vaultItems(userId), queryFn: () => api.vaultItems() })
