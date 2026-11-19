import { toast } from '../../components/ui/toast.ts'
import { t } from '../../i18n/index.ts'

import type { QueryClient, QueryFilters } from '@tanstack/react-query'

/**
 * Reads what a write changed. A read already in flight may have started before the write, so it
 * is dropped first rather than reused. If the new read fails, the rows on screen stay and the
 * user is told they may be out of date.
 */
export async function refreshAfterWrite(client: QueryClient, filters: QueryFilters): Promise<void> {
  await client.cancelQueries(filters)
  try {
    await client.invalidateQueries(filters, { throwOnError: true })
  } catch (e) {
    toast.apiError(t('Could not refresh — showing cached data'), e, {
      fallback: t('Check your connection and try again.'),
    })
  }
}
