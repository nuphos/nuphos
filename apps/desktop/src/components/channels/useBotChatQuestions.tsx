import { DismissQuestionButton } from '../../views/inbox/DismissQuestionButton'
import { answerDecision } from '../../views/inbox/useInbox'
import { inputRequestKey } from '../agent/summary/sessionInputRequests'
import { useSessionInputRequests } from '../agent/summary/useSessionInputRequests'

import { BotChatQuestion } from './BotChatQuestions'
import { useBotCredentials } from './useBotCredentials'

import type { TimelineRow } from './ChannelMessages'
import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'

/**
 * The open questions of a Bot and of every agent under it, as lines in the Bot's
 * chat at the time each was asked, drawn from the same records the Inbox reads,
 * so answering here answers there. An answer wakes the agent that asked, which
 * replies where it asked; no message is sent. The card leaves at once, and comes
 * back with the error if the answer was refused. Dismissing withdraws it
 * unanswered, as the Inbox does, and wakes no one.
 * The Bot's own Connect cards select through the Bot's credential picker, which
 * its owner also gets in the chat's composer.
 */
export function useBotChatQuestions(
  teamId: string,
  botId: string | undefined,
  botOwned: boolean,
  onOpenSession: (sessionId: string) => void,
): { rows: TimelineRow[]; credentials?: CredentialSelectorControl } {
  const botCredentials = useBotCredentials(teamId, botOwned ? botId : undefined)
  // A chat opening draws what the Inbox lists now, never a cached row's old
  // questions, and never another Bot's.
  const { requests } = useSessionInputRequests(botId ?? null, teamId)

  const rows = requests.map((request) => {
    const answer = (decision: DecisionAnswer, requestId: string) =>
      void answerDecision(teamId, request.sessionId, requestId, decision)

    return {
      at: Date.parse(request.inputRequest.askedAt) || 0,
      key: `question-${inputRequestKey(request)}`,
      node: (
        // Inset past the faces on both sides, so the card lines up with the bubbles.
        <div className="flex flex-col gap-1 px-[2.375rem]">
          <BotChatQuestion
            request={request}
            teamId={teamId}
            credentials={request.sessionId === botId ? botCredentials : undefined}
            // The Bot's own questions are this chat's; only an agent under it is named.
            onOpenSession={request.sessionId === botId ? undefined : onOpenSession}
            onAnswer={answer}
          />
          {/* Withdrawn on the agent that asked, which drops it here and in the Inbox. */}
          <DismissQuestionButton
            teamId={teamId}
            sessionId={request.sessionId}
            requestId={request.inputRequest.id}
            className="self-end"
          />
        </div>
      ),
    }
  })

  return { rows, credentials: botCredentials }
}
