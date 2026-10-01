import type { ConversationTriggerRun } from '../conversation-trigger-run'
import type { MessageMetadata } from '../message-metadata'
import type { AgentMessageOrigin } from '../message-origin'
import type { AgentClientMeta, AgentConversation, AgentCredentialAccess } from './shared'

export type ConversationTranscriptSync = {
  sessionId: string
  userId: string
  teamId?: string
  title: string
  firstMessage: string
  messages: {
    id: string
    role: 'user' | 'assistant'
    parts: unknown[]
    metadata?: MessageMetadata
    origin?: AgentMessageOrigin
    turnOrigin?: 'autonomous'
    turnKind?: 'plan-approval'
  }[]
  locale?: string
  provider?: string
  source?: string
  trigger?: ConversationTriggerRun
  client?: AgentClientMeta
  preserveTitle?: boolean
  credentialAccess?: AgentCredentialAccess
  agentRuntime?: NonNullable<AgentConversation['agentRuntime']>
  runtimeId?: string
  runtimeLabel?: string
}
