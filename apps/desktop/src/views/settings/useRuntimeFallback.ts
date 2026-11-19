import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { runtimeFallbackQuery } from '../../lib/query/runtime'

/** The team's fallback per runtime, and the save both this panel and a failed turn use. */
export function useRuntimeFallback(teamId: string, runtimeId: string | undefined, enabled = true) {
  const queryClient = useQueryClient()
  const { queryKey } = runtimeFallbackQuery(teamId)
  const { data: fallbacks, error } = useQuery({ ...runtimeFallbackQuery(teamId), enabled })
  const { mutateAsync, isPending } = useMutation({
    mutationFn: (next: string | null) => api.atlasPutRuntimeFallback(teamId, runtimeId!, next),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.apiError(t('Could not save the fallback runtime'), err),
  })

  useEffect(() => {
    if (error) toast.apiError(t('Could not load the fallback runtime'), error)
  }, [error])

  return { fallbacks, save: mutateAsync, isPending }
}
