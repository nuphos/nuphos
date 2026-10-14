import type { MessageMetadata } from './message-metadata'

export type PendingUserMessage = {
  id: string
  /** Execution principal this instruction is allowed to steer. */
  actorUserId?: string
  metadata?: MessageMetadata
  /** Fully rendered for the model by the bridge that received it, so draining
   *  never has to know which channel the message came from. */
  renderedText: string
  source: string
  receivedAt: string
}

// A resource wake-up is only "<event> on <PR>"; the session reads the PR itself.
// One identical to a parked wake-up adds nothing, so it takes no slot. Distinct
// events keep one each, and the parked one keeps its acknowledged id.
export function wakeUpKey(message: PendingUserMessage): string {
  const url = message.source === 'agent.resource' ? message.metadata?.resourceUrl : undefined

  return url ? `${url} ${message.renderedText}` : ''
}
