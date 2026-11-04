import { inTokenTeamScope, tokenTeamScope } from '@/lib/identity/token-team-scope'

/**
 * Who in the team sees a conversation without being invited: nobody, or
 * everyone to read. Replying follows the conversation's computer instead, so a
 * stored 'reply' reads as 'view'. A chat has no computer: posting there
 * follows its members, so it keeps team-wide 'reply'.
 */
export type GeneralAccess = 'none' | 'view' | 'reply'
/** What one viewer may do: whoever may use the conversation's computer replies. */
export type ConversationAccess = 'owner' | 'reply' | 'view'

/** What the owner may choose; a chat may also choose 'reply'. */
export function generalAccessValues(conversation: { kind?: string }): readonly GeneralAccess[] {
  return conversation.kind === 'channel' ? ['none', 'view', 'reply'] : ['none', 'view']
}

// Spelled out rather than picked from AgentConversation, so shared.ts can use
// this module without the two importing each other.
/** Who besides the owner may read a conversation. */
export type ReadGrants = {
  generalAccess?: GeneralAccess
  /** 'channel' for a chat. */
  kind?: string
  participantIds?: string[]
}
type AccessFields = ReadGrants & { userId: string; teamId?: string }

// Absent is every conversation from before access existed, which the whole
// team could already open. It stays open to read, and a chat to post in.
export function generalAccessOf(conversation: ReadGrants): GeneralAccess {
  const stored = conversation.generalAccess ?? 'reply'

  return stored === 'reply' && conversation.kind !== 'channel' ? 'view' : stored
}

/** Whether the viewer is invited; the owner is not a participant. */
export function isParticipant(conversation: ReadGrants, userId: string): boolean {
  return conversation.participantIds?.includes(userId) ?? false
}

/**
 * What the viewer may do, given whether they may use the computer the
 * conversation runs on (see conversation-computer.ts); undefined when it runs
 * on no one's computer. Whoever may use the computer replies, invited or not:
 * being invited only puts the conversation in their list. Team membership is
 * the caller's to verify: this only reads the conversation.
 */
export function conversationAccess(
  conversation: AccessFields,
  viewerId: string,
  usesComputer?: boolean,
): ConversationAccess | null {
  // An agent token reaches only its own team's conversations, its user's included.
  if (!inTokenTeamScope(conversation.teamId)) return null
  if (conversation.userId === viewerId) return 'owner'
  if (!conversation.teamId) return null
  // Without a computer, being invited is what lets someone reply.
  if (usesComputer ?? isParticipant(conversation, viewerId)) return 'reply'
  if (isParticipant(conversation, viewerId)) return 'view'

  const general = generalAccessOf(conversation)

  return general === 'none' ? null : general
}

/** Whether the conversation is shared with the viewer, whatever computer it runs on. */
export function readsConversation(conversation: AccessFields, viewerId: string): boolean {
  return conversationAccess(conversation, viewerId, false) !== null
}

export function canReply(access: ConversationAccess | null) {
  return access === 'owner' || access === 'reply'
}

/** The Mongo form of readsConversation, for list and read queries. */
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

/** A read filter: the owner alone without a team, else whoever it is shared with. */
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
