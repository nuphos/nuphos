import type { AgentChatBody } from './types'

/** The question a Desktop message answers, when it names one the resolve route would accept. */
export function decisionReplyOf(body: Pick<AgentChatBody, 'decisionReplyTo'>): string | undefined {
  const id = body.decisionReplyTo

  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : undefined
}
