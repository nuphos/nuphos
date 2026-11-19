import { useRuntimeQuotasQuery } from '../lib/query/runtime.ts'

import type { RuntimeQuota } from '../types/runtime'

const EMPTY: ReadonlyMap<string, RuntimeQuota> = new Map()

export function useRuntimeQuotas(teamId?: string): ReadonlyMap<string, RuntimeQuota> {
  const { data } = useRuntimeQuotasQuery(teamId)

  // Quota is decoration: a failed read keeps whatever was shown before.
  return data ?? EMPTY
}
