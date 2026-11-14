import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useEffect } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { t } from '../../i18n'
import { runtimeFallbackQuery } from '../../lib/query/runtime'

import { SectionHeader } from './shared'

import type { RuntimeInstance } from '../../types/runtime'

function where(instance: RuntimeInstance): string {
  return instance.local ? instance.local.deviceLabel : t('Team agent')
}

/** Settings → My preferences → Agent fallback. */
export function RuntimeFallbackSection({ teamId }: { teamId: string }) {
  const { instances } = useRuntimeInstances(teamId)
  const queryClient = useQueryClient()
  const { data: runtimeIds, error } = useQuery(runtimeFallbackQuery(teamId))
  // One save at a time, so a slower earlier save cannot land after a later one. The save carries
  // its team, so switching teams meanwhile cannot write one team's list into another's.
  const { mutate, isPending: saving } = useMutation({
    mutationFn: async ({ target, next }: { target: string; next: string[] }) =>
      (await api.atlasPutRuntimeFallback(target, next)).runtimeIds,
    onMutate: async ({ target, next }) => {
      const { queryKey } = runtimeFallbackQuery(target)

      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)

      queryClient.setQueryData(queryKey, next)

      return previous
    },
    onSuccess: (saved, { target }) =>
      queryClient.setQueryData(runtimeFallbackQuery(target).queryKey, saved),
    onError: (err, { target }, previous) => {
      queryClient.setQueryData(runtimeFallbackQuery(target).queryKey, previous)
      toast.apiError(t('Could not save your fallback agents'), err)
    },
  })
  const save = (next: string[]) => mutate({ target: teamId, next })

  useEffect(() => {
    if (error) toast.apiError(t('Could not load your fallback agents'), error)
  }, [error])

  function move(index: number, by: -1 | 1) {
    if (!runtimeIds) return
    const next = [...runtimeIds]

    ;[next[index], next[index + by]] = [next[index + by], next[index]]
    save(next)
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
            <ol className="divide-y divide-line-control rounded-lg border border-line-control">
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
                        disabled={saving || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('Move down')}
                        disabled={saving || index === listed.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('Remove')}
                        disabled={saving}
                        onClick={() => save(listed.filter((entry) => entry !== id))}
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
            disabled={saving || choices.length === 0}
            options={choices.map((instance) => ({
              value: instance.id,
              label: instance.label,
              description: where(instance),
            }))}
            onValueChange={(id) => {
              if (id) save([...listed, id])
            }}
          />
        </div>
      )}
    </div>
  )
}
