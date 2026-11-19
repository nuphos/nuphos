import { useState } from 'react'

import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { leaveSession } from '../agent/channelPeople'
import { AppAlertDialog } from '../ui/alert-dialog'
import { toast } from '../ui/toast'

/** Leaving someone else's Task can cost access to it, so it asks first. */
export function useLeaveTaskConfirm(teamId: string) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const viewerId = useCurrentUser()?.id ?? ''

  return {
    confirm: setSessionId,
    dialog: (
      <AppAlertDialog
        open={sessionId !== null}
        title={t('Leave this task?')}
        description={t(
          "It disappears from your list. If you can't use its computer, the owner will need to invite you again.",
        )}
        confirmLabel={t('Leave task')}
        onConfirm={() => {
          if (sessionId)
            void leaveSession(sessionId, teamId, viewerId).catch((err: unknown) =>
              toast.apiError(t('Could not leave task'), err),
            )
        }}
        onClose={() => setSessionId(null)}
      />
    ),
  }
}
