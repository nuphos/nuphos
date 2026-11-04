import { inTokenTeamScope, tokenTeamScope } from '@/lib/identity/token-team-scope'

/**
 * Who in the team may read a conversation without being invited: nobody, or
 * everyone. Reading needs no computer; replying does, so only invitees reply.
 * A stored 'reply' predates that rule and reads as 'view'.
 */
export type GeneralAccess = 'none' | 'view'
/** What one viewer may do: a participant replies while they may use the conversation's computer. */
export type ConversationAccess = 'owner' | 'reply' | 'view'

export const GENERAL_ACCESS_VALUES: readonly GeneralAccess[] = ['none', 'view']

// Spelled out rather than picked from AgentConversation, so shared.ts can use
// this module without the two importing each other.
/** Who besides the owner may read a conversation. */
export type ReadGrants = {
  generalAccess?: GeneralAccess | 'reply'
  participantIds?: string[]
}
type AccessFields = ReadGrants & { userId: string; teamId?: string }

// Absent is every conversation from before access existed, which the whole
// team could already open. It stays open to read.
export function generalAccessOf(conversation: ReadGrants): GeneralAccess {
  return conversation.generalAccess === 'none' ? 'none' : 'view'
}

/** Whether the viewer is invited; the owner is not a participant. */
export function isParticipant(conversation: ReadGrants, userId: string): boolean {
  return conversation.participantIds?.includes(userId) ?? false
}

/**
 * What the viewer may do, given whether they may use the computer the
 * conversation runs on (see conversation-computer.ts). Team membership is the
 * caller's to verify: this only reads the conversation.
 */
export function conversationAccess(
  conversation: AccessFields,
  viewerId: string,
  usesComputer: boolean,
): ConversationAccess | null {
  // An agent token reaches only its own team's conversations, its user's included.
  if (!inTokenTeamScope(conversation.teamId)) return null
  if (conversation.userId === viewerId) return 'owner'
  if (!conversation.teamId) return null
  if (isParticipant(conversation, viewerId)) return usesComputer ? 'reply' : 'view'

  return generalAccessOf(conversation) === 'view' ? 'view' : null
}

/** Whether the viewer may read the conversation at all. */
export function readsConversation(conversation: AccessFields, viewerId: string): boolean {
  return conversationAccess(conversation, viewerId, false) !== null
}

export function canReply(access: ConversationAccess | null) {
  return access === 'owner' || access === 'reply'
}

/** The Mongo form of "conversationAccess is not null", for list and read queries. */
export function readableByFilter(viewerId: string) {
  return {
    $or: [{ userId: viewerId }, { generalAccess: { $ne: 'none' } }, { participantIds: viewerId }],
  }
}

/**
 * Every new conversation is private until shared, whichever way it was
 * created: the app, an external client, a transcript sync, an agent thread.
 * Only conversations that live where the team already talks — a Slack,
 * Discord or Lark channel, or a trigger's run — start team-wide.
 */
export function initialGeneralAccess(source: string | undefined): GeneralAccess | undefined {
  const teamWide =
    source !== undefined &&
    (['slack.', 'discord.', 'lark.', 'agent.trigger.'].some((prefix) =>
      source.startsWith(prefix),
    ) ||
      source === 'agent.trigger')

  return teamWide ? undefined : 'none'
}

/** What a new thread copies from its parent, so whoever can read the parent can read its threads. */
export function threadReadGrants(parent: ReadGrants): ReadGrants {
  return {
    generalAccess: generalAccessOf(parent),
    ...(parent.participantIds?.length ? { participantIds: parent.participantIds } : {}),
  }
}

/** Who may read a new conversation: its parent's readers for a thread, else its source's default. */
export function initialReadGrants(source: string | undefined, parent?: ReadGrants): ReadGrants {
  if (parent) return threadReadGrants(parent)
  const generalAccess = initialGeneralAccess(source)

  return generalAccess ? { generalAccess } : {}
}

/** A read filter: the owner alone without a team, else whoever conversationAccess admits. */
export function readableConversationScope(
  base: Record<string, unknown>,
  viewerUserId: string,
  teamId: string | undefined,
): Record<string, unknown> {
  // An agent token reads its own team's conversations, whatever the caller asked for.
  teamId = tokenTeamScope() ?? teamId
  if (!teamId) return { ...base, userId: viewerUserId }

  return { ...base, teamId, ...readableByFilter(viewerUserId) }
}
