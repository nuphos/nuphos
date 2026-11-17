import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

/**
 * Withdraws an open question unanswered: no message is sent, and the agent
 * that asked is told it was skipped. Every list of open questions, the Inbox
 * and a Bot's chat alike, catches up on the refresh this starts, which also
 * drops one that was already gone. False, with why, when it could not be withdrawn.
 */
export async function dismissQuestion(
  teamId: string | undefined,
  sessionId: string,
  requestId: string,
): Promise<boolean> {
  try {
    await api.agentResolveDecision(sessionId, requestId, teamId, 'dismissed')

    return true
  } catch (error) {
    toast.apiError(t('Could not dismiss question'), error)

    return false
  } finally {
    refreshInputRequests()
  }
}
