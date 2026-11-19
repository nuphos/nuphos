import { useState } from 'react'

import { useThisComputer } from '../../../hooks/useThisComputer'
import { t } from '../../../i18n'
import { managesRuntime } from '../../../views/settings/agentPresentation'
import {
  editsRuntime,
  fallbackCandidates,
  offersFallbackSetup,
  saveFallbackThenMove,
} from '../../../views/settings/runtimeFallback'
import { useAgentDevices } from '../../../views/settings/useAgentDevices'
import { useRuntimeFallback } from '../../../views/settings/useRuntimeFallback'
import { toast } from '../../ui/toast'

import { FallbackSetupDialog } from './FallbackSetupDialog'
import { latestFailure, reinstallProvider, turnSwitchAgent } from './turnFailureActions'

import type { PanelViewCtx } from './ctx'
import type { RuntimeControl } from './RuntimeSelector'

/**
 * The actions on a Task's failed turn. Switch runtime opens this panel's runtime list, whose
 * open state lives here so no other composer for the session opens too. When the runtime could
 * not run the turn and has no fallback, Set up fallback sets one for the team (the setting
 * runtime details shows) and moves the Task there.
 */
export function useTurnFailureActions(c: PanelViewCtx, control: RuntimeControl | undefined) {
  const agentMenu = useState(false)
  const teamId = c.teamId ?? ''
  const failure = latestFailure(c.activeTab)
  const failed = Boolean(teamId && failure?.cause)
  const runtime = c.runtimeInstances.find((instance) => instance.id === c.activeTab?.runtimeId)
  const device = useAgentDevices(() => 0, teamId, {
    teamId,
    enabled: failed && Boolean(runtime?.local),
  }).list?.devices.find((entry) => entry.deviceId === runtime?.local?.deviceId)
  const { fallbacks, save } = useRuntimeFallback(teamId, runtime?.id, failed)
  const reinstall = reinstallProvider(failure?.cause, runtime, useThisComputer())
  const [open, setOpen] = useState(false)
  const move = control?.onSelect
  const offered = offersFallbackSetup({
    cause: failure?.cause,
    runtime,
    edits: runtime ? editsRuntime(runtime, managesRuntime(runtime, device, c.isTeamAdmin)) : false,
    canMove: Boolean(move),
    fallbacks,
  })

  const turnSwitch = turnSwitchAgent(
    c.activeTab,
    () => agentMenu[1](true),
    offered ? () => setOpen(true) : undefined,
  )
  const fallbackDialog = control && runtime && move && (
    <FallbackSetupDialog
      open={open && offered}
      runtime={runtime}
      candidates={fallbackCandidates(control.options ?? [], runtime.id)}
      control={control}
      onClose={() => setOpen(false)}
      onManage={c.onOpenAgentSettings}
      onSave={(next) =>
        saveFallbackThenMove(
          () => save(next),
          () => {
            setOpen(false)
            toast.success(t('Fallback saved for {name}', { name: runtime.label }))
            move(next)
          },
        )
      }
    />
  )

  return { agentMenu, turnSwitch: turnSwitch && { ...turnSwitch, fallbackDialog, reinstall } }
}
