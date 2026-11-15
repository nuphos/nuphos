import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

/**
 * Withdraws an open question unanswered: no message is sent and the agent is
 * not woken. Every list of open questions, the Inbox and a Bot's chat alike,
 * drops it on the refresh this starts. False when it could not be withdrawn.
 */
export async function dismissQuestion(
  teamId: string | undefined,
  sessionId: string,
  requestId: string,
): Promise<boolean> {
  try {
    await api.agentResolveDecision(sessionId, requestId, teamId, 'dismissed')
    refreshInputRequests()

    return true
  } catch (error) {
    toast.apiError(t('Could not dismiss question'), error)

    return false
  }
}
