import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { t } from '../../../i18n'
import { agentTier } from '../../../lib/agentName'
import { openBoxPaywall } from '../../../views/settings/boxPaywallStore'
import { boxRestarts } from '../../../views/settings/boxRestartStore'
import { LocalAgentSignIn } from '../../../views/settings/LocalAgentSignIn'
import { RuntimeLoginDialog } from '../../../views/settings/RuntimeLoginDialog'
import { toast } from '../../ui/toast'

import type { AgentFix, AgentRowViewer } from './agentRowFix'
import type { TeamMember } from '../../../types/team'

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
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [signIn, setSignIn] = useState<Extract<AgentFix, { kind: 'signIn' | 'cli' }> | null>(null)
  const loadMembers = open && Boolean(teamId) && !members

  useEffect(() => {
    if (!loadMembers || !teamId) return
    let stopped = false

    void api.atlasListTeamMembers(teamId).then(
      (list) => !stopped && setMembers(list),
      () => {},
    )

    return () => {
      stopped = true
    }
  }, [loadMembers, teamId])

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
      mark(key, true)
      // Stays "Resuming…" until the computer is back and leaves this row.
      api.boxResume(fix.deviceId, teamId).then(
        () => boxRestarts.start(fix.deviceId, teamId, 'resume'),
        (error: unknown) => {
          mark(key, false)
          // A Resume the plan has no room for: the paywall offers one, then resumes.
          if (!openBoxPaywall(teamId, error, () => run(fix)))
            toast.apiError(t('Could not resume computer'), error)
        },
      )
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
