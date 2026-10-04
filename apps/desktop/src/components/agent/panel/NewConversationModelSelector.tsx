import { ChevronDown, ChevronLeft, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'
import { normalizeRuntimeDefaults } from '../../../views/settings/runtimeDefaults'
import { useRuntimeModelCatalog } from '../../../views/settings/useRuntimeModelCatalog'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../../ui/menu'
import { toast } from '../../ui/toast'

import type { RuntimeDefaults, RuntimeInstance } from '../../../types/runtime'

/**
 * Model picker for a conversation that has no session yet: it edits the default
 * the first message applies. A Cloud agent's is the team's (admins only); a
 * local agent's belongs to its owner alone.
 */
export function NewConversationModelSelector({
  teamId,
  runtime,
  isTeamAdmin,
}: {
  teamId?: string
  runtime: RuntimeInstance | null
  isTeamAdmin: boolean
}) {
  const [saving, setSaving] = useState(false)
  const local = runtime?.kind === 'local'
  const canEdit = local || isTeamAdmin
  const canLoad = Boolean(teamId && canEdit && runtime?.status === 'active' && !runtime.starting)
  const currentModel = runtime?.defaults?.model === 'default' ? undefined : runtime?.defaults?.model
  const discovery = useRuntimeModelCatalog(teamId ?? '', runtime?.id ?? '', canLoad, currentModel)

  const displayedModel = currentModel ?? discovery.catalog?.controls?.modelId
  const label = displayedModel
    ? (discovery.models.find((model) => model.id === displayedModel)?.name ?? displayedModel)
    : 'Model'

  const modelLoading = !displayedModel
  const controls = discovery.catalog?.controls
  const efforts = controls?.effort.filter((option) => option.value !== 'default') ?? []
  const inheritedEffort = runtime?.defaults?.effort ?? controls?.defaultEffort
  const effort =
    efforts.find((option) => option.value === inheritedEffort)?.value ??
    efforts.find((option) => option.value === 'medium')?.value ??
    efforts[0]?.value
  const initialization = useRef('')
  const initialKey = JSON.stringify([teamId, runtime?.id, displayedModel, inheritedEffort, effort])

  const effortLabel = efforts.find((option) => option.value === effort)?.name ?? effort

  const select = useCallback(
    async (value: RuntimeDefaults) => {
      if (!teamId || !runtime || saving) return
      setSaving(true)
      try {
        const defaults = normalizeRuntimeDefaults(value)

        if (local) await api.localAgentSetDefaults(runtime.id, defaults)
        else await api.atlasUpdateRuntimeInstance(teamId, runtime.id, { defaults })
        window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
      } catch (error) {
        toast.apiError('Could not change model settings', error)
      } finally {
        setSaving(false)
      }
    },
    [teamId, runtime, saving, local],
  )

  useEffect(() => {
    if (
      !canLoad ||
      saving ||
      !effort ||
      effort === inheritedEffort ||
      initialization.current === initialKey
    )
      return
    initialization.current = initialKey
    void select({ ...runtime?.defaults, model: displayedModel, effort })
  }, [
    canLoad,
    saving,
    effort,
    inheritedEffort,
    initialKey,
    displayedModel,
    runtime?.defaults,
    select,
  ])
  if (!teamId || !canEdit || !runtime) return null

  return (
    <Menu>
      <MenuTrigger
        aria-label={modelLoading ? 'Loading model' : `Model for this agent: ${label}`}
        aria-busy={modelLoading}
        className="flex h-7 min-w-0 max-w-48 items-center gap-1 rounded-full px-2 text-[12px] text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main"
      >
        {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        {modelLoading ? (
          <span
            aria-hidden="true"
            className="h-3 w-24 rounded bg-zGray-700/60 animate-pulse motion-reduce:animate-none"
          />
        ) : (
          <span className="truncate">{label}</span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuContent side="top" align="end" className="w-72">
        {discovery.loading && (
          <p role="status" className="flex items-center gap-2 px-2.5 py-2 text-xs text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading models…
          </p>
        )}
        {discovery.error && !discovery.loading && (
          <p role="alert" className="px-2.5 py-2 text-xs text-error">
            {discovery.error}
          </p>
        )}
        {discovery.models.map((model) => (
          <MenuItem
            key={model.id}
            selected={model.id === displayedModel}
            disabled={saving}
            closeOnClick={false}
            onClick={() => void select({ model: model.id })}
          >
            {model.name}
          </MenuItem>
        ))}
        {Boolean(efforts.length) && (
          <>
            <MenuSeparator />
            <MenuSubmenu>
              <MenuSubmenuTrigger
                disabled={saving || discovery.loading}
                chevron={<ChevronLeft className="h-3 w-3 opacity-60" />}
              >
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span>Effort</span>
                  <span className="text-xs text-tertiary">{effortLabel}</span>
                </span>
              </MenuSubmenuTrigger>
              <MenuContent side="left" align="end" className="w-48">
                {efforts.map((option) => (
                  <MenuItem
                    key={option.value}
                    selected={option.value === effort}
                    disabled={saving || discovery.loading}
                    closeOnClick={false}
                    onClick={() =>
                      void select({
                        ...runtime.defaults,
                        model: displayedModel,
                        effort: option.value,
                      })
                    }
                  >
                    {option.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </MenuSubmenu>
          </>
        )}
        {discovery.error && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={
                discovery.loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )
              }
              disabled={discovery.loading}
              closeOnClick={false}
              onClick={discovery.retry}
            >
              Retry
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
