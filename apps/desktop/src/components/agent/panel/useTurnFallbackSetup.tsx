import { useState } from 'react'

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
import { latestFailure, turnSwitchAgent } from './turnFailureActions'

import type { PanelViewCtx } from './ctx'
import type { RuntimeControl } from './RuntimeSelector'

/**
 * The Task's latest turn failed because its runtime could not run it, and that runtime has no
 * fallback: offers to set one for the team (the setting runtime details shows) and move there.
 */
export function useTurnFallbackSetup(c: PanelViewCtx, control: RuntimeControl | undefined) {
  const teamId = c.teamId ?? ''
  const failure = latestFailure(c.activeTab)
  const failed = Boolean(teamId && failure?.cause)
  const runtime = c.runtimeInstances.find((instance) => instance.id === c.activeTab?.runtimeId)
  const device = useAgentDevices(() => 0, teamId, {
    teamId,
    enabled: failed && Boolean(runtime?.local),
  }).list?.devices.find((entry) => entry.deviceId === runtime?.local?.deviceId)
  const { fallbacks, save } = useRuntimeFallback(teamId, runtime?.id, failed)
  const [open, setOpen] = useState(false)
  const move = control?.onSelect
  const offered = offersFallbackSetup({
    cause: failure?.cause,
    runtime,
    edits: runtime ? editsRuntime(runtime, managesRuntime(runtime, device, c.isTeamAdmin)) : false,
    canMove: Boolean(move),
    fallbacks,
  })

  return {
    // The failure line's actions: Switch runtime, and this setup while it is offered.
    turnSwitch: turnSwitchAgent(c.activeTab, offered ? () => setOpen(true) : undefined),
    dialog: control && runtime && move && (
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
    ),
  }
}
