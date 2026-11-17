import { api } from '../../api'
import { cardReplyId } from '../../components/agent/panel/replyTarget'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

import { returnTime } from './snooze'

import type { DecisionCardRef, ReplyQuestion } from '../../components/agent/panel/replyTarget'

/**
 * Dismisses an open question from its card: no message is sent, and the agent
 * that asked is told it was dismissed. Every list of open questions, the Inbox
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

/**
 * Snoozes an open question out of its owner's Inbox until `until`, or brings it
 * back with null. It stays open in its chat and the agent is not told.
 */
export async function snoozeQuestion(
  teamId: string | undefined,
  sessionId: string,
  requestId: string,
  until: Date | null,
): Promise<boolean> {
  try {
    await api.agentSnoozeDecision(sessionId, requestId, teamId, until?.toISOString() ?? null)
    if (until) toast.success(t('Snoozed until {time}', { time: returnTime(until.toISOString()) }))

    return true
  } catch (error) {
    toast.apiError(until ? t('Could not snooze question') : t('Could not unsnooze question'), error)

    return false
  } finally {
    refreshInputRequests()
  }
}

/**
 * A conversation's cards dismissed or snoozed through the server, each naming the
 * open request it shows. Only the owner snoozes: it is their Inbox it leaves.
 */
export function cardAsides(
  teamId: string | undefined,
  sessionId: string,
  questions: readonly ReplyQuestion[] | undefined,
  owner: boolean,
) {
  return {
    dismiss: (card: DecisionCardRef) =>
      dismissQuestion(teamId, sessionId, cardReplyId(card, questions)),
    snooze: owner
      ? (card: DecisionCardRef, until: Date) =>
          void snoozeQuestion(teamId, sessionId, cardReplyId(card, questions), until)
      : undefined,
  }
}
