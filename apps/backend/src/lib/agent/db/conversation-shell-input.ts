import type { ConversationTriggerRun } from '../conversation-trigger-run'
import type { ReadGrants } from './access'
import type { AgentClientMeta, AgentConversation, AgentCredentialAccess } from './shared'

export type ConversationShellInput = {
  sessionId: string
  userId: string
  teamId?: string
  title: string
  firstMessage: string
  locale?: string
  provider?: string
  source?: string
  /**
   * The trigger that fired this conversation, when one did. Write-once by
   * construction — it lives in `metadata`, which only $setOnInsert touches —
   * because every later turn (the agent's own, or a teammate continuing the
   * run from the Trigger page) arrives without trigger context and would
   * otherwise erase the only link back to the Trigger.
   */
  trigger?: ConversationTriggerRun
  client?: AgentClientMeta
  credentialAccess?: AgentCredentialAccess
  agentRuntime?: NonNullable<AgentConversation['agentRuntime']>
  runtimeId?: string
  runtimeLabel?: string
  parentSessionId?: string
  delegation?: { requestId: string; promptHash: string }
  originChannelIds?: string[]
  /** A thread's parent, whose readers it copies in place of what its source starts with. */
  parentGrants?: ReadGrants
  kind?: 'channel'
  /** Created as a Bot: its face, and a name the title generator leaves alone. */
  instructions?: string
  botOnboarding?: 'pending'
  avatar?: string
  workspace?: NonNullable<AgentConversation['workspace']>
}
