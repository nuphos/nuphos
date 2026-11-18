import { RuntimeSelector } from '../../components/agent/panel/RuntimeSelector'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { t } from '../../i18n'
import { useRuntimeQuotasQuery } from '../../lib/query/runtime'

import { fallbackCandidates } from './runtimeFallback'
import { PanelHeading } from './RuntimePanel'
import { useRuntimeFallback } from './useRuntimeFallback'

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
