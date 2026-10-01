import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'
import { normalizeRuntimeDefaults } from '../../../views/settings/runtimeDefaults'
import { useRuntimeModelCatalog } from '../../../views/settings/useRuntimeModelCatalog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/menu'
import { toast } from '../../ui/toast'

import type { RuntimeInstance } from '../../../types/runtime'

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
  const discovery = useRuntimeModelCatalog(
    teamId ?? '',
    runtime?.id ?? '',
    canLoad,
    runtime?.defaults?.model,
  )

  if (!teamId || !canEdit || !runtime) return null
  const currentModel = runtime.defaults?.model
  const label = currentModel
    ? (discovery.models.find((model) => model.id === currentModel)?.name ?? currentModel)
    : 'Agent default'

  async function select(model: string | undefined) {
    if (!teamId || !runtime || saving) return
    setSaving(true)
    try {
      // A model change resets effort/Fast — they only make sense against the
      // model they were validated for, and the settings screen can re-set them.
      const defaults = normalizeRuntimeDefaults({ model })

      if (local) await api.localAgentSetDefaults(runtime.id, defaults)
      else await api.atlasUpdateRuntimeInstance(teamId, runtime.id, { defaults })
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    } catch (error) {
      toast.apiError('Could not change the model', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Model for this agent: ${label}`}
        className="flex h-7 min-w-0 max-w-48 items-center gap-1 rounded-full px-2 text-[12px] text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main"
      >
        {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuContent side="top" align="end" className="w-72">
        <div className="px-2.5 py-1.5 text-[11px] text-tertiary">
          {local ? 'Your model for this computer’s agent' : 'Default model for this agent'}
        </div>
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
        <MenuItem
          selected={!currentModel}
          disabled={saving}
          closeOnClick={false}
          onClick={() => void select(undefined)}
        >
          Agent default
        </MenuItem>
        {discovery.models.map((model) => (
          <MenuItem
            key={model.id}
            selected={model.id === currentModel}
            disabled={saving}
            title={model.description}
            closeOnClick={false}
            onClick={() => void select(model.id)}
          >
            <span className="flex flex-col gap-0.5">
              <span>{model.name}</span>
              {model.description && (
                <span className="text-[11px] text-tertiary">{model.description}</span>
              )}
            </span>
          </MenuItem>
        ))}
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
        <MenuSeparator />
        <p className="px-2.5 py-2 text-[11px] text-tertiary">
          {local
            ? 'Applies to your new conversations on this agent. Nobody else uses it.'
            : 'This changes the agent’s default for every new conversation, not just this one.'}
        </p>
      </MenuContent>
    </Menu>
  )
}
