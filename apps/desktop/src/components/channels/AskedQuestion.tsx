import { answeredBySelection } from '../agent/panel/connectCardModel'

import { BotChatQuestion } from './BotChatQuestions'
import { useBotCredentials } from './useBotCredentials'

import type { SessionInputRequest } from '../agent/summary/sessionInputRequests'
import type { ComponentProps } from 'react'

/** A question whose Connect card, unless given the Bot's picker, selects in the conversation that asked. */
export function AskedQuestion({
  credentials,
  ...props
}: Omit<ComponentProps<typeof BotChatQuestion>, 'request'> & { request: SessionInputRequest }) {
  const { request, teamId } = props
  const asked = useBotCredentials(
    teamId,
    !credentials && answeredBySelection(request.inputRequest) && request.canManage
      ? request.sessionId
      : undefined,
  )

  return <BotChatQuestion {...props} credentials={credentials ?? asked} />
}
