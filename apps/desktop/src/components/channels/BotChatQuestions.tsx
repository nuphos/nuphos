import { ArrowUpRight } from 'lucide-react'

import { api } from '../../api'
import { t } from '../../i18n'
import { AnswerFailure } from '../../views/inbox/AnswerFailure'
import { answerQuestion, useAnswerFailure } from '../../views/inbox/useInbox'
import { DecisionToolPart } from '../agent/panel/ConnectCard'
import { ConnectCardContext } from '../agent/panel/connectCardContext'

import { botChatQuestion } from './botChatQuestion'

import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'
import type { SessionInputRequest } from '../agent/summary/sessionInputRequests'

/** One open question in a Bot's chat, answerable where the card itself can send the answer. */
export function BotChatQuestion({
  request,
  teamId,
  credentials,
  onOpenSession,
  onAnswer,
  fullBody,
}: {
  request: Pick<SessionInputRequest, 'sessionId' | 'title' | 'inputRequest'>
  teamId: string
  /** The asking conversation's credential picker, for its Connect card; absent where it cannot be changed here. */
  credentials?: CredentialSelectorControl
  /** Absent for the Bot's own questions, which need no "From" line. */
  onOpenSession?: (sessionId: string) => void
  /** Answers the question: the server wakes the agent that asked. */
  onAnswer: (answer: DecisionAnswer, requestId: string) => void
  /** Shows the question's body in full, as the Inbox does. */
  fullBody?: boolean
}) {
  const { part, questions, answerable, replyTo } = botChatQuestion(
    request.inputRequest,
    credentials !== undefined,
  )
  const failure = useAnswerFailure(request.inputRequest.id)

  return (
    <div className="flex flex-col gap-1.5">
      {onOpenSession && (
        <button
          type="button"
          onClick={() => onOpenSession(request.sessionId)}
          className="flex items-center gap-1 self-start text-[12px] text-tertiary hover:text-main"
        >
          {t('From {name}', { name: request.title || t('Untitled task') })}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </button>
      )}
      <ConnectCardContext.Provider
        value={{
          credentials,
          // Only a secure card sends: the line naming where its value was saved.
          send: (text, card) => void answerQuestion(teamId, request.sessionId, replyTo(card), text),
          answer: (answer, card) => onAnswer(answer, replyTo(card)),
          // Written on the asking agent's runtime, as its own secure card writes it.
          saveSecret: async (name, value) =>
            (await api.agentSaveSecret(request.sessionId, name, value, teamId)).path,
          openQuestions: questions,
          fullBody,
        }}
      >
        <DecisionToolPart
          part={part}
          now={0}
          teamId={teamId}
          canAct={answerable}
          canReply={answerable}
        />
      </ConnectCardContext.Provider>
      {failure && <AnswerFailure message={failure} />}
    </div>
  )
}
