import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from '../../api'
import { RuntimeSelector } from '../../components/agent/panel/RuntimeSelector'
import { toast } from '../../components/ui/toast'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { t } from '../../i18n'
import { runtimeFallbackQuery, useRuntimeQuotasQuery } from '../../lib/query/runtime'

import { fallbackCandidates } from './runtimeFallback'
import { PanelHeading } from './RuntimePanel'

import type { RuntimeInstance } from '../../types/runtime'

/** The team's fallback per runtime, and the save both this panel and a failed turn use. */
export function useRuntimeFallback(teamId: string, runtimeId: string | undefined, enabled = true) {
  const queryClient = useQueryClient()
  const { queryKey } = runtimeFallbackQuery(teamId)
  const { data: fallbacks, error } = useQuery({ ...runtimeFallbackQuery(teamId), enabled })
  const { mutateAsync, isPending } = useMutation({
    mutationFn: (next: string | null) => api.atlasPutRuntimeFallback(teamId, runtimeId!, next),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.apiError(t('Could not save the fallback agent'), err),
  })

  useEffect(() => {
    if (error) toast.apiError(t('Could not load the fallback agent'), error)
  }, [error])

  return { fallbacks, save: mutateAsync, isPending }
}

/** The agent this one's conversations move to when it runs out or breaks; set for the whole team. */
export function RuntimeFallbackPicker({
  teamId,
  instance,
  canEdit,
}: {
  teamId: string
  instance: RuntimeInstance
  canEdit: boolean
}) {
  const { instances } = useRuntimeInstances(teamId)
  const { fallbacks, save, isPending } = useRuntimeFallback(teamId, instance.id)
  // Its own toast says why a save failed.
  const mutate = (next: string | null) => void save(next).catch(() => {})
  const { data: quotas } = useRuntimeQuotasQuery(teamId)
  const current = fallbacks?.[instance.id]
  const target = instances.find((other) => other.id === current)
  const editable = canEdit && Boolean(fallbacks)

  return (
    <div>
      <PanelHeading
        title={t('Fallback')}
        hint={t(
          'When this agent is low on usage, offline, or fails a turn, its conversations move to the agent chosen here, then on to that agent’s fallback. The conversation history always moves; files in this agent’s working directory may stay behind.',
        )}
      />
      <RuntimeSelector
        teamId={teamId}
        value={target ?? null}
        options={fallbackCandidates(instances, instance.id)}
        quotas={quotas}
        loading={!fallbacks}
        selectDisabled={isPending}
        emptyLabel={t('None')}
        onSelect={
          editable
            ? (next) => {
                if (next !== current) mutate(next)
              }
            : undefined
        }
        onClear={editable && current ? () => mutate(null) : undefined}
      />
    </div>
  )
}
