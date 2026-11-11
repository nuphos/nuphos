import { t } from '../../i18n'
import { DismissQuestionButton } from '../../views/inbox/DismissQuestionButton'
import { answerInChat, answerQuestion } from '../../views/inbox/useInbox'
import { inputRequestKey } from '../agent/summary/sessionInputRequests'
import { useSessionInputRequests } from '../agent/summary/useSessionInputRequests'

import { BotChatQuestion } from './BotChatQuestions'
import { sendingPost } from './sendingPosts'
import { useBotCredentials } from './useBotCredentials'

import type { TimelineRow } from './ChannelMessages'
import type { AgentMessageReply, AgentPersistedMessage } from '../../api'
import type { UserInfo } from '../../types'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'
import type { Dispatch, SetStateAction } from 'react'

/** The chat's own posting: where the answer to the Bot's own question goes. */
type ChatPosting = {
  channelId: string
  user: UserInfo
  setSending: Dispatch<SetStateAction<AgentPersistedMessage[]>>
  stickToBottom: () => void
  refresh: () => void
  /** Quotes a question above the composer; what is sent next is `answer`ed instead of posted. */
  reply: (quote: AgentMessageReply, answer: (text: string) => void) => void
}

/**
 * The open questions of a Bot and of every agent under it, as lines in the Bot's
 * chat at the time each was asked, drawn from the same records the Inbox reads,
 * so answering here answers there. A choice is the viewer's own message: a post
 * here for the Bot's own question, shown at once as any post is, else in the conversation that
 * asked. The card leaves at once, and comes back with the error if it could not
 * be sent.
 * The Bot's own Connect cards select through the Bot's credential picker, which
 * its owner also gets in the chat's composer.
 */
export function useBotChatQuestions(
  teamId: string,
  botId: string | undefined,
  botOwned: boolean,
  onOpenSession: (sessionId: string) => void,
  chat: ChatPosting,
): { rows: TimelineRow[]; credentials?: CredentialSelectorControl } {
  const botCredentials = useBotCredentials(teamId, botOwned ? botId : undefined)
  // A chat opening draws what the Inbox lists now, never a cached row's old
  // questions, and never another Bot's.
  const { requests } = useSessionInputRequests(botId ?? null, teamId)

  const answerHere = (text: string, requestId: string) => {
    const id = crypto.randomUUID()

    chat.stickToBottom()
    chat.setSending((posts) => [...posts, sendingPost(id, text, chat.user)])
    void answerInChat(teamId, chat.channelId, requestId, text, id).then((sent) =>
      sent ? chat.refresh() : chat.setSending((posts) => posts.filter((post) => post.id !== id)),
    )
  }

  const rows = requests.map((request) => {
    const answer = (text: string, replyTo: string) =>
      request.sessionId === botId
        ? answerHere(text, replyTo)
        : void answerQuestion(teamId, request.sessionId, replyTo, text)

    return {
      at: Date.parse(request.inputRequest.askedAt) || 0,
      key: `question-${inputRequestKey(request)}`,
      node: (
        <div className="flex flex-col gap-1">
          <BotChatQuestion
            request={request}
            teamId={teamId}
            credentials={request.sessionId === botId ? botCredentials : undefined}
            // The Bot's own questions are this chat's; only an agent under it is named.
            onOpenSession={request.sessionId === botId ? undefined : onOpenSession}
            onAnswer={answer}
            onReply={(replyTo) =>
              chat.reply(
                {
                  id: replyTo,
                  authorName: request.title || t('Untitled agent'),
                  text: request.inputRequest.question,
                },
                (text) => answer(text, replyTo),
              )
            }
          />
          {/* A question none of the choices fits, or one the work moved past, is closed here as in the Inbox. */}
          <DismissQuestionButton
            teamId={teamId}
            sessionId={request.sessionId}
            requestId={request.inputRequest.id}
            className="self-end px-1"
          />
        </div>
      ),
    }
  })

  return { rows, credentials: botCredentials }
}
