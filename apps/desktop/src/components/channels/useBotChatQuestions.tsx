import { answerDecision } from '../../views/inbox/useInbox'
import { inputRequestKey } from '../agent/summary/sessionInputRequests'
import { useSessionInputRequests } from '../agent/summary/useSessionInputRequests'

import { AskedQuestion } from './AskedQuestion'
import { ChooseAccessBanner } from './channelParts'
import { useBotCredentials } from './useBotCredentials'

import type { TimelineRow } from './ChannelMessages'
import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'
import type { ReactNode } from 'react'

/**
 * The open questions of a Bot and of every agent under it, as lines in the Bot's
 * chat at the time each was asked, drawn from the same records the Inbox reads,
 * so answering here answers there. An answer wakes the agent that asked, which
 * replies where it asked; no message is sent. The card leaves at once, and comes
 * back with the error if the answer was refused. Dismissing withdraws it
 * unanswered, and the agent that asked is told.
 * The Bot's own Connect cards select through the Bot's credential picker, which
 * its owner also gets in Bot details. An agent's under it select in the asking
 * conversation, as the Inbox card does: a Task's selection is its Bot's.
 */
export function useBotChatQuestions(
  teamId: string,
  botId: string | undefined,
  botOwned: boolean,
  onOpenSession: (sessionId: string) => void,
  /** The chat has no posts yet: the choose-access banner goes under its intro, not in the timeline. */
  empty: boolean,
): {
  rows: TimelineRow[]
  credentials?: CredentialSelectorControl & { unset: boolean }
  banner?: ReactNode
} {
  const botCredentials = useBotCredentials(teamId, botId)
  const ownCredentials = botOwned ? botCredentials : undefined
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
        <div className="px-[2.375rem]" data-open-question>
          <AskedQuestion
            request={request}
            teamId={teamId}
            credentials={request.sessionId === botId ? ownCredentials : undefined}
            // The Bot's own questions are this chat's; only an agent under it is named.
            onOpenSession={request.sessionId === botId ? undefined : onOpenSession}
            dismissible
            onAnswer={answer}
          />
        </div>
      ),
    }
  })

  // A Bot never given computers or credentials is asked to choose, below everything said so far.
  const banner = botId && ownCredentials?.unset ? <ChooseAccessBanner bot={botId} /> : undefined

  if (banner && !empty)
    rows.push({
      at: Number.MAX_SAFE_INTEGER,
      key: 'choose-access',
      // Inset past the faces on both sides, so the banner lines up with the bubbles.
      node: <div className="px-[2.375rem]">{banner}</div>,
    })

  return { rows, credentials: botCredentials, banner: empty ? banner : undefined }
}
