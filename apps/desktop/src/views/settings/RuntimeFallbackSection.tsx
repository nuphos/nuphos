import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { t } from '../../i18n'

import { SectionHeader } from './shared'

import type { AtlasTeam } from '../../types'
import type { RuntimeInstance } from '../../types/runtime'

function where(instance: RuntimeInstance): string {
  return instance.local ? instance.local.deviceLabel : t('Team agent')
}

/** Settings → My preferences → Agent fallback. */
export function RuntimeFallbackSection({ team }: { team: AtlasTeam | undefined }) {
  const teamId = team?.id
  const { instances } = useRuntimeInstances(teamId)
  const [runtimeIds, setRuntimeIds] = useState<string[] | null>(null)

  useEffect(() => {
    if (!teamId) return
    let cancelled = false

    api.atlasGetRuntimeFallback(teamId).then(
      (fallback) => {
        if (!cancelled) setRuntimeIds(fallback.runtimeIds)
      },
      (err: unknown) => {
        toast.apiError(t('Could not load your fallback agents'), err)
      },
    )

    return () => {
      cancelled = true
    }
  }, [teamId])

  async function save(next: string[]) {
    if (!teamId) return
    const previous = runtimeIds

    setRuntimeIds(next)
    try {
      setRuntimeIds((await api.atlasPutRuntimeFallback(teamId, next)).runtimeIds)
    } catch (err) {
      setRuntimeIds(previous)
      toast.apiError(t('Could not save your fallback agents'), err)
    }
  }

  function move(index: number, by: -1 | 1) {
    if (!runtimeIds) return
    const next = [...runtimeIds]

    ;[next[index], next[index + by]] = [next[index + by], next[index]]
    void save(next)
  }

  const listed = runtimeIds ?? []
  const choices = instances.filter(
    (instance) => instance.status === 'active' && !listed.includes(instance.id),
  )

  return (
    <div>
      <SectionHeader
        title={t('Agent fallback')}
        description={t(
          'When the agent a conversation runs on is low on usage, offline, or fails a turn, Nuphos moves the conversation to the first agent in this list that can take it. A move between agents on the same computer keeps the conversation’s files; any other move carries only the conversation history.',
        )}
      />

      {runtimeIds && (
        <div className="space-y-3">
          {listed.length > 0 ? (
            <ol className="divide-y divide-zGray-800 rounded-lg border border-zGray-800">
              {listed.map((id, index) => {
                const instance = instances.find((candidate) => candidate.id === id)

                return (
                  <li key={id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="w-4 text-right text-tertiary tabular-nums">{index + 1}</span>
                    {instance && (
                      <AgentProviderIcon
                        provider={instance.provider}
                        className="h-4 w-4 shrink-0"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-main">
                      {instance?.label ?? id}
                    </span>
                    <span className="truncate text-[12px] text-tertiary">
                      {instance ? where(instance) : t('No longer available')}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('Move up')}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('Move down')}
                        disabled={index === listed.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('Remove')}
                        onClick={() => void save(listed.filter((entry) => entry !== id))}
                      >
                        <X size={14} />
                      </Button>
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="text-[13px] text-tertiary">
              {t('No fallback agents. Conversations stay on their agent when it runs out.')}
            </p>
          )}

          <AppSelect
            size="sm"
            className="w-72"
            value=""
            placeholder={t('Add an agent')}
            ariaLabel={t('Add an agent')}
            disabled={choices.length === 0}
            options={choices.map((instance) => ({
              value: instance.id,
              label: instance.label,
              description: where(instance),
            }))}
            onValueChange={(id) => {
              if (id) void save([...listed, id])
            }}
          />
        </div>
      )}
    </div>
  )
}
