import type { AgentCredentialAccess } from './db/shared'
import type { MessageMetadata } from './message-metadata'
import type { UIMessage } from 'ai'

/** An app send the backend queued. It runs later as its sender's own chat turn,
 *  on the stream the sender's device opened, so only that device runs its tools. */
export type QueuedChatTurn = {
  streamId: string
  message: UIMessage
  locale: string
  localTools: boolean
  kubeContext?: string
  diagramId?: string
  currentUrl?: string | null
  credentialAccess?: AgentCredentialAccess
}

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
  /** Set for an app send: the turn it starts is a chat turn, never folded into another. */
  chat?: QueuedChatTurn
  /** Times a turn took this message and could not run it. */
  attempts?: number
}

// A resource wake-up is only "<event> on <PR>"; the session reads the PR itself.
// One identical to a parked wake-up adds nothing, so it takes no slot. Distinct
// events keep one each, and the parked one keeps its acknowledged id.
export function wakeUpKey(message: PendingUserMessage): string {
  const url = message.source === 'agent.resource' ? message.metadata?.resourceUrl : undefined

  return url ? `${url} ${message.renderedText}` : ''
}

// Answered in the transcript, so any turn can take them. A channel message
// (Slack, Lark, Discord) is answered in its channel by the handler that got it.
export const TRANSCRIPT_SOURCES = ['agent.thread', 'agent.resource', 'mcp', 'app'] as const

// The queue owner's own messages may predate actor stamping.
export function parkedFor(userId: string, actorUserId: string, sources?: readonly string[]) {
  return (message: PendingUserMessage) =>
    (message.actorUserId === actorUserId || (!message.actorUserId && actorUserId === userId)) &&
    (!sources || sources.includes(message.source))
}
