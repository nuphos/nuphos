import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n/index.ts'
import { track } from '../../../lib/analytics'
import { writeDefaultPermissionMode } from '../../../lib/permissionMode'
import { toast } from '../../ui/toast'

import { announceSettingsChanged, onSettingsChanged } from './sessionSettingsChanged'

/**
 * Saves a conversation's permission mode: the one write a Task's composer and a Bot's chat
 * share. The remembered mode for new conversations only follows a pick the server accepted.
 */
export function saveBypass(
  sessionId: string,
  next: boolean,
  { saved, failed }: { saved?: () => void; failed: () => void },
) {
  api.agentSetAutoModeBypass(sessionId, next).then(
    () => {
      writeDefaultPermissionMode(localStorage, next ? 'bypass' : 'auto')
      saved?.()
      announceSettingsChanged(sessionId)
      // Only after the server accepted it: a reverted toggle is not a decision.
      track('agent_permission_mode_changed', {
        mode: next ? 'bypass' : 'auto',
        session_id: sessionId,
      })
    },
    (err: unknown) => {
      failed()
      toast.apiError(t('Could not update Full Access'), err, {
        fallback: t('The change was not saved — please try again.'),
      })
    },
  )
}

/** The permission mode control for one conversation, as the composer takes it. */
export function useBypassControl(sessionId: string | undefined) {
  const [active, setActive] = useState<{ sessionId: string; bypass: boolean }>()

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    const load = () =>
      void api.agentGetAutoModeBypass(sessionId).then(
        ({ bypass }) => {
          if (alive) setActive({ sessionId, bypass })
        },
        () => {
          // Unreachable or not created yet: the control simply doesn't show.
        },
      )
    const stop = onSettingsChanged(sessionId, load)

    load()

    return () => {
      alive = false
      stop()
    }
  }, [sessionId])
  if (!sessionId || active?.sessionId !== sessionId) return undefined
  const bypass = active.bypass

  return {
    active: bypass,
    onSelect: (next: boolean) => {
      if (next === bypass) return
      setActive({ sessionId, bypass: next })
      saveBypass(sessionId, next, { failed: () => setActive({ sessionId, bypass }) })
    },
  }
}
