import { api } from '../../../api'
import { t } from '../../../i18n'
import { boxRestarts } from '../../../views/settings/boxRestartStore'
import { toast } from '../../ui/toast'

export async function resumeBox(deviceId: string, teamId: string) {
  try {
    await api.boxResume(deviceId, teamId)
    boxRestarts.start(deviceId, teamId, 'resume')
  } catch (error) {
    toast.apiError(t('Could not resume computer'), error)
  }
}

/** Nudges the owner of the computer this conversation waits on; a repeat notifies nobody. */
export async function remindOwner(teamId: string, runtimeId: string, sessionId: string) {
  try {
    await api.localShareRemind(teamId, runtimeId, sessionId)
    toast.info(t('Reminder sent'))
  } catch (error) {
    toast.apiError(t('Could not send the reminder'), error)
  }
}
