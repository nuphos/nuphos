import { useContext } from 'react'

import { ChoiceCard } from './ChoiceCard'
import { ConnectCard } from './ConnectCard'
import { ConnectCardContext } from './connectCardContext'
import {
  decisionRequestId,
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
} from './connectCardModel'
import { DecisionConversations } from './DecisionConversations'
import { cardAnswerState, matchInputRequest } from './replyTarget'
import { SecretCard } from './SecretCard'
import { ToolPartView } from './ToolPartView'
import { isDecisionFailed } from './toolRuns'

import type { ToolPart } from './parts'
import type { DecisionCardRef } from './replyTarget'

/** A user decision: a Connect card when it lists `providers`, a secure input card when it names a `secretName`, else its question card; the plain tool row until the input parses. */
function DecisionCardContent({
  part,
  now,
  teamId,
  canAct,
  canReply,
}: {
  part: ToolPart
  now: number
  teamId?: string
  /** The latest idle reply. */
  canAct: boolean
  canReply: boolean
}) {
  const openQuestions = useContext(ConnectCardContext)?.openQuestions
  const failed = isDecisionFailed(part)
  const connect = failed ? null : parseConnectRequest(part.input)
  const secret = failed || connect ? null : parseSecretRequest(part.input)
  const choice = failed || connect || secret ? null : parseChoiceRequest(part.input)
  const requestId = decisionRequestId(part.output)
  const state = (card: Omit<DecisionCardRef, 'toolCallId' | 'requestId'>) =>
    cardAnswerState({ toolCallId: part.toolCallId, requestId, ...card }, openQuestions, {
      latestIdle: canAct,
      canReply,
    })

  if (connect) {
    return (
      <ConnectCard
        toolCallId={part.toolCallId}
        teamId={teamId}
        providers={connect.providers}
        reason={connect.reason}
        personal={connect.personal}
        canAct={state({ question: connect.reason }) === 'open'}
      />
    )
  }
  if (secret) {
    return (
      <SecretCard
        {...secret}
        toolCallId={part.toolCallId}
        requestId={requestId}
        state={state({ question: secret.reason, secretName: secret.name })}
      />
    )
  }
  if (choice) {
    return (
      <ChoiceCard
        {...choice}
        toolCallId={part.toolCallId}
        canAct={state({ question: choice.question, options: choice.options }) === 'open'}
      />
    )
  }

  return <ToolPartView part={part} now={now} />
}

/** Recipient names come from the server's open request, never agent-supplied tool input. */
export function DecisionToolPart(props: Parameters<typeof DecisionCardContent>[0]) {
  const requests = useContext(ConnectCardContext)?.openQuestions
  const { part } = props
  const connect = parseConnectRequest(part.input)
  const secret = parseSecretRequest(part.input)
  const choice = parseChoiceRequest(part.input)
  const request = matchInputRequest(
    {
      toolCallId: part.toolCallId,
      requestId: decisionRequestId(part.output),
      question: connect?.reason ?? secret?.reason ?? choice?.question,
      options: choice?.options,
      secretName: secret?.name,
    },
    requests ?? [],
  )

  return (
    <div className="flex flex-col gap-2">
      <DecisionConversations conversations={request?.aboutConversations} teamId={props.teamId} />
      <DecisionCardContent {...props} />
    </div>
  )
}
