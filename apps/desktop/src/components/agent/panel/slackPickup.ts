import { api } from '../../../api'
import { t } from '../../../i18n/index.ts'
import { toast } from '../../ui/toast'

import { slackThreadFallbackUrl } from './slackThreadUrl'

/**
 * "Pick up in Slack" (from the All-chats context menu): bind the conversation
 * to the owner's Slack DM so replies there continue the same session. The
 * bind is idempotent — a conversation that already has a thread just opens
 * it, which also makes this the "Open Slack thread" action for bound rows.
 */
export async function pickUpConversationInSlack(sessionId: string, teamId?: string): Promise<void> {
  try {
    const result = await api.agentSlackPickup(sessionId, teamId)

    if (result.status === 'already_bound') {
      const thread = result.slackThread

      await api.appOpenExternal(thread.url ?? slackThreadFallbackUrl(thread))

      return
    }
    toast.success(
      t('Picked up in Slack'),
      t('Reply in your Slack DM with Nuphos to continue with this agent.'),
    )
  } catch (err) {
    toast.apiError(t('Couldn’t pick this agent up in Slack'), err)
  }
}
