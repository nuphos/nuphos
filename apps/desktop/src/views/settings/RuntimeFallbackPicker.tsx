import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from '../../api'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { t } from '../../i18n'
import { runtimeFallbackQuery } from '../../lib/query/runtime'

import { PanelHeading } from './RuntimePanel'

import type { RuntimeInstance } from '../../types/runtime'

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
  const queryClient = useQueryClient()
  const { queryKey } = runtimeFallbackQuery(teamId)
  const { data: fallbacks, error } = useQuery(runtimeFallbackQuery(teamId))
  const { mutate, isPending } = useMutation({
    mutationFn: (next: string | null) => api.atlasPutRuntimeFallback(teamId, instance.id, next),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.apiError(t('Could not save the fallback agent'), err),
  })

  useEffect(() => {
    if (error) toast.apiError(t('Could not load the fallback agent'), error)
  }, [error])

  const current = fallbacks?.[instance.id] ?? ''
  const options = [
    { value: '', label: t('None') },
    ...instances
      .filter((other) => other.id !== instance.id && other.status === 'active')
      .map((other) => ({
        value: other.id,
        label: other.label,
        description: other.local ? other.local.deviceLabel : t('Team agent'),
      })),
  ]

  return (
    <div>
      <PanelHeading
        title={t('Fallback')}
        hint={t(
          'When this agent is low on usage, offline, or fails a turn, its conversations move to the agent chosen here, then on to that agent’s fallback. The conversation history always moves; files in this agent’s working directory may stay behind.',
        )}
      />
      <AppSelect
        size="sm"
        className="w-72"
        value={current}
        ariaLabel={t('Fallback')}
        disabled={!canEdit || !fallbacks || isPending}
        options={options}
        onValueChange={(next) => {
          if (next !== current) mutate(next || null)
        }}
      />
    </div>
  )
}
