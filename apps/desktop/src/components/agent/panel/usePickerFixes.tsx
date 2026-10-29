import { useState } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'
import { useTeamMemberList } from '../../../hooks/useTeamMemberList'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { t } from '../../../i18n'
import { agentTier } from '../../../lib/agentName'
import { openBoxPaywall } from '../../../views/settings/boxPaywallStore'
import { boxRestarts } from '../../../views/settings/boxRestartStore'
import { LocalAgentSignIn } from '../../../views/settings/LocalAgentSignIn'
import { RuntimeLoginDialog } from '../../../views/settings/RuntimeLoginDialog'
import { toast } from '../../ui/toast'

import { resumeComputer } from './agentRowFix'

import type { AgentFix, AgentRowViewer } from './agentRowFix'

export type PickerFixes = {
  viewer: AgentRowViewer
  /** Starts the fix; a sign-in closes the menu for its dialog. */
  run: (fix: AgentFix) => void
  /** The fix is underway: a Box resuming, or a computer being looked at again. */
  busy: (fix: AgentFix) => boolean
}

function busyKey(fix: AgentFix): string | null {
  if (fix.kind === 'resume') return `resume:${fix.deviceId}`

  return fix.kind === 'retry' ? 'retry' : null
}

/** Everything the picker can fix in place, and the sign-in dialogs that outlive its menu. */
export function usePickerFixes({
  teamId,
  isTeamAdmin,
  open,
  closeMenu,
  onSettings,
}: {
  teamId?: string
  isTeamAdmin: boolean
  open: boolean
  closeMenu: () => void
  onSettings?: () => void
}): { fixes: PickerFixes; dialogs: React.ReactNode } {
  const viewerId = useCurrentUser()?.id
  const thisComputer = useThisComputer()
  // Keyed by team: a selector that outlives a team switch never names the last team's admin.
  const members = useTeamMemberList(teamId, open)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [signIn, setSignIn] = useState<Extract<AgentFix, { kind: 'signIn' | 'cli' }> | null>(null)
  const mark = (key: string, on: boolean) =>
    setPending((previous) => {
      const next = new Set(previous)

      if (on) next.add(key)
      else next.delete(key)

      return next
    })

  const run = (fix: AgentFix) => {
    const key = busyKey(fix)

    if (key && pending.has(key)) return
    if (fix.kind === 'signIn' || fix.kind === 'cli') {
      closeMenu()
      setSignIn(fix)
    } else if (fix.kind === 'settings') {
      closeMenu()
      onSettings?.()
    } else if (fix.kind === 'resume' && key && teamId) {
      void resumeComputer({
        deviceId: fix.deviceId,
        resume: (deviceId) => api.boxResume(deviceId, teamId),
        setBusy: (on) => mark(key, on),
        onResumed: () => {
          boxRestarts.start(fix.deviceId, teamId, 'resume')
          toast.success(t('Resuming computer'), t('It is ready to pick once it is back online.'))
        },
        onFailed: (error) => {
          // A Resume the plan has no room for: the paywall offers one, then resumes.
          if (!openBoxPaywall(teamId, error, () => run(fix)))
            toast.apiError(t('Could not resume computer'), error)
        },
      })
    } else if (fix.kind === 'retry' && key) {
      mark(key, true)
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
      setTimeout(() => mark(key, false), 1_500)
    }
  }

  const dialogs =
    signIn?.kind === 'signIn' && teamId ? (
      <RuntimeLoginDialog
        teamId={teamId}
        instance={signIn.instance}
        onClose={() => setSignIn(null)}
      />
    ) : signIn?.kind === 'cli' ? (
      <LocalAgentSignIn provider={signIn.provider} initiallyOpen onClosed={() => setSignIn(null)} />
    ) : null

  return {
    fixes: {
      viewer: {
        viewerId,
        isTeamAdmin,
        onThisComputer: (instance) => agentTier(instance, thisComputer) === 'local',
        members,
      },
      run,
      busy: (fix) => {
        const key = busyKey(fix)

        return Boolean(key && pending.has(key))
      },
    },
    dialogs,
  }
}
