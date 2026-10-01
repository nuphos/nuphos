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
