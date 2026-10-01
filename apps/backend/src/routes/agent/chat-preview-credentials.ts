import { getConversation, updateConversationCredentialAccess } from '@/lib/agent/db'
import { logError } from '@/lib/observability'

import {
  allCredentialAccessFromOptions,
  hasCredentialOptions,
  isEmptyCredentialAccess,
} from './credential-access'
import { getAgentCredentialOptions } from './credential-options'

import type { AgentConversation } from '@/lib/agent/db'

type PreviewCredentialDependencies = {
  getConversation: typeof getConversation
  getCredentialOptions: typeof getAgentCredentialOptions
  updateCredentialAccess: typeof updateConversationCredentialAccess
}

type PreviewChannelCredentialArgs = {
  channelOriginated: boolean
  selectAllCredentials?: boolean
  sessionId: string
  teamId: string
  actorUserId: string
  conversationOwnerUserId: string
  acceptedTurn: Promise<unknown>
}

const defaultDependencies: PreviewCredentialDependencies = {
  getConversation,
  getCredentialOptions: getAgentCredentialOptions,
  updateCredentialAccess: updateConversationCredentialAccess,
}

/**
 * Claude/OpenAB reads credential selection through the conversation-scoped MCP
 * mount, so its defaults must be durable before the first prompt starts. The
 * classic model loop resolves the same default in memory; the preview path
 * bypasses that resolver and therefore needs this explicit preflight.
 */
export async function ensurePreviewChannelCredentials(
  args: PreviewChannelCredentialArgs,
  dependencies: PreviewCredentialDependencies = defaultDependencies,
): Promise<AgentConversation | null> {
  // A shared channel turn cannot persist the actor's defaults onto another
  // member's conversation. Its per-turn identity needs a separate capability
  // model; never widen the owner's durable selection here.
  if (!args.channelOriginated || args.actorUserId !== args.conversationOwnerUserId) return null

  await args.acceptedTurn
  const [conversation, options] = await Promise.all([
    dependencies.getConversation(args.sessionId, args.conversationOwnerUserId, args.teamId),
    dependencies.getCredentialOptions(args.teamId, args.actorUserId),
  ])

  if (
    !conversation ||
    !isEmptyCredentialAccess(conversation.credentialAccess) ||
    !hasCredentialOptions(options)
  ) {
    return conversation
  }

  return await dependencies.updateCredentialAccess(
    args.sessionId,
    args.conversationOwnerUserId,
    args.teamId,
    allCredentialAccessFromOptions(options, args.actorUserId, args.selectAllCredentials),
  )
}

/** Credential discovery should not take down a turn, but remains observable. */
export async function ensurePreviewChannelCredentialsSafe(
  args: PreviewChannelCredentialArgs & { requestId: string; source: string },
): Promise<AgentConversation | null> {
  try {
    return await ensurePreviewChannelCredentials(args)
  } catch (err) {
    logError('agent.chat.preview_default_credentials.error', err, {
      request_id: args.requestId,
      user_id: args.actorUserId,
      conversation_owner_user_id: args.conversationOwnerUserId,
      session_id: args.sessionId,
      team_id: args.teamId,
      source: args.source,
    })

    return null
  }
}

export type { PreviewChannelCredentialArgs, PreviewCredentialDependencies }
