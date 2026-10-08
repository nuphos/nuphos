/**
 * Who in the team may open a conversation without being invited: nobody, or
 * everyone — to read, or to read and reply. Invitees add to it; they can raise
 * what one person may do, never lower it below this.
 */
export type GeneralAccess = 'none' | 'view' | 'reply'
export type ParticipantRole = 'view' | 'reply'
/** What one viewer may do in a conversation. */
export type ConversationAccess = 'owner' | ParticipantRole

export const GENERAL_ACCESS_VALUES: readonly GeneralAccess[] = ['none', 'view', 'reply']
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['view', 'reply']

// Spelled out rather than picked from AgentConversation, so shared.ts can use
// this module without the two importing each other.
type GrantFields = {
  generalAccess?: GeneralAccess
  participantIds?: string[]
  viewOnlyIds?: string[]
}
type AccessFields = GrantFields & { userId: string; teamId?: string }

// Absent is every conversation from before access existed, which the whole
// team could already read and reply to. Reading it that way keeps them as they
// were without a migration.
export function generalAccessOf(conversation: GrantFields) {
  return conversation.generalAccess ?? 'reply'
}

/** A participant's own grant; the owner is not a participant. */
export function participantRole(conversation: GrantFields, userId: string): ParticipantRole | null {
  if (!conversation.participantIds?.includes(userId)) return null

  return conversation.viewOnlyIds?.includes(userId) ? 'view' : 'reply'
}

/**
 * The broader of the team-wide grant and the viewer's own, the way Notion
 * resolves a page. Team membership is the caller's to verify: this only reads
 * the conversation.
 */
export function conversationAccess(
  conversation: AccessFields,
  viewerId: string,
): ConversationAccess | null {
  if (conversation.userId === viewerId) return 'owner'
  if (!conversation.teamId) return null
  const general = generalAccessOf(conversation)
  const own = participantRole(conversation, viewerId)

  if (general === 'reply' || own === 'reply') return 'reply'
  if (general === 'view' || own === 'view') return 'view'

  return null
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

/** A read filter: the owner alone without a team, else whoever conversationAccess admits. */
export function readableConversationScope(
  base: Record<string, unknown>,
  viewerUserId: string,
  teamId: string | undefined,
): Record<string, unknown> {
  if (!teamId) return { ...base, userId: viewerUserId }

  return { ...base, teamId, ...readableByFilter(viewerUserId) }
}
