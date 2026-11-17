import { api } from '../../api'
import { AnswerFailure } from '../../views/inbox/AnswerFailure'
import { dismissQuestion } from '../../views/inbox/dismissQuestion'
import { DismissQuestionButton } from '../../views/inbox/DismissQuestionButton'
import { QuestionSource } from '../../views/inbox/QuestionRail'
import { answerQuestion, useAnswerFailure } from '../../views/inbox/useInbox'
import { DecisionToolPart } from '../agent/panel/ConnectCard'
import { ConnectCardContext } from '../agent/panel/connectCardContext'
import { parseChoiceRequest } from '../agent/panel/connectCardModel'

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
  dismissible,
  onAnswer,
  onLinkClick,
  fullBody,
}: {
  request: Pick<
    SessionInputRequest,
    'sessionId' | 'title' | 'avatar' | 'agentRuntime' | 'inputRequest'
  >
  teamId: string
  /** The asking conversation's credential picker, for its Connect card; absent where it cannot be changed here. */
  credentials?: CredentialSelectorControl
  /** Absent for the Bot's own questions, which name no source. */
  onOpenSession?: (sessionId: string) => void
  /** It can be withdrawn unanswered from here. */
  dismissible?: boolean
  /** Answers the question: the server wakes the agent that asked. */
  onAnswer: (answer: DecisionAnswer, requestId: string) => void
  /** Opens a link in the question's body, as the conversation does. */
  onLinkClick?: (href: string, beside: boolean) => boolean
  /** Shows the question's body in full, as the Inbox does. */
  fullBody?: boolean
}) {
  const { part, questions, answerable, replyTo } = botChatQuestion(
    request.inputRequest,
    credentials !== undefined,
  )
  const failure = useAnswerFailure(request.inputRequest.id)
  // A question card names who asked and is dismissed inside itself; the other cards keep both outside.
  const choice = parseChoiceRequest(part.input) !== null
  const source = onOpenSession && (
    <QuestionSource
      conversation={request}
      askedAt={request.inputRequest.askedAt}
      onOpen={() => onOpenSession(request.sessionId)}
    />
  )
  const dismiss = dismissible
    ? () => dismissQuestion(teamId, request.sessionId, request.inputRequest.id)
    : undefined

  return (
    <div className="flex flex-col gap-1.5">
      {!choice && source}
      <ConnectCardContext.Provider
        value={{
          credentials,
          // Only a secure card sends: the line naming where its value was saved.
          send: (text, card) => void answerQuestion(teamId, request.sessionId, replyTo(card), text),
          answer: (answer, card) => onAnswer(answer, replyTo(card)),
          dismiss,
          source,
          // Written on the asking agent's runtime, as its own secure card writes it.
          saveSecret: async (name, value) =>
            (await api.agentSaveSecret(request.sessionId, name, value, teamId)).path,
          openQuestions: questions,
          fullBody,
          onLinkClick,
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
      {!choice && dismissible && (
        <DismissQuestionButton
          teamId={teamId}
          sessionId={request.sessionId}
          requestId={request.inputRequest.id}
          className="self-end"
        />
      )}
    </div>
  )
}
