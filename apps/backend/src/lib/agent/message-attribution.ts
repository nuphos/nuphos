import { trustedAvatarURL } from '../identity/avatar-url'

import { getConversationBySessionId } from './db'
import { addConversationParticipants } from './db/participants'
import { getAgentDevice } from './devices/store'
import { agentMessages } from './db/shared'
import { noteMentions, resolveMentions } from './mentions'
import { assertSingleNewUserMessage } from './message-input'
import { restoreAppMessageMetadata, parseMessageMetadata } from './message-metadata'

import type { MessageMetadata } from './message-metadata'
import type { CliTokenPrincipal } from '@/lib/identity/cli-tokens'
import type { UIMessage } from 'ai'

import { getNuphosUserById } from '@/lib/identity/auth'
import { logError } from '@/lib/observability'

/**
 * `deviceId` is client-claimed, so it only counts when registered to this user.
 * `cliToken` is the stored token the request authenticated with: an agent
 * token's message is the bot's, sent on the user's behalf.
 */
export async function createMessageMetadata(
  userId: string,
  source: MessageMetadata['source'],
  deviceId?: string,
  cliToken?: CliTokenPrincipal,
): Promise<MessageMetadata> {
  const [user, device] = await Promise.all([
    getNuphosUserById(userId),
    deviceId ? getAgentDevice(userId, deviceId) : null,
  ])

  const displayName = user?.name || user?.username || userId
  const token = cliToken ? { cliTokenId: cliToken.id } : {}

  if (cliToken?.kind === 'agent') {
    return {
      version: 1,
      sender: {
        type: 'agent',
        id: cliToken.id,
        displayName: cliToken.name,
        ...(cliToken.avatarUrl ? { avatarURL: cliToken.avatarUrl } : {}),
        onBehalfOf: { id: userId, displayName },
      },
      source,
      sentAt: new Date().toISOString(),
      ...token,
    }
  }

  return {
    version: 1,
    sender: {
      type: 'user',
      id: userId,
      displayName,
      // Discord and Lark threads can be read by people outside the team.
      ...(user?.email && (source === 'nuphos' || source === 'slack') ? { email: user.email } : {}),
      ...(trustedAvatarURL(user?.avatarURL)
        ? { avatarURL: trustedAvatarURL(user?.avatarURL) }
        : {}),
    },
    ...(device ? { device: { label: device.label, platform: device.platform } } : {}),
    source,
    sentAt: new Date().toISOString(),
    ...token,
  }
}

/** Client history is not a source of verified attribution. Restore it by ID. */
export async function attributeAppMessages(
  messages: UIMessage[],
  sessionId: string,
  ownerId: string,
  actorId: string,
  continuation: boolean,
  deviceId?: string,
  cliToken?: CliTokenPrincipal,
  teamId?: string,
): Promise<void> {
  const stored = await agentMessages()
    .find(
      { sessionId, userId: ownerId, messageId: { $in: messages.map((m) => m.id) } },
      { projection: { messageId: 1, metadata: 1, origin: 1, turnOrigin: 1, role: 1, parts: 1 } },
    )
    .toArray()

  if (!continuation) assertSingleNewUserMessage(messages, new Set(stored.map((m) => m.messageId)))
  const byId = new Map(stored.map((m) => [m.messageId, parseMessageMetadata(m.metadata)]))
  const last = messages.at(-1)
  const fresh =
    !continuation && last?.role === 'user' && !byId.has(last.id)
      ? await createMessageMetadata(actorId, 'nuphos', deviceId, cliToken)
      : undefined

  // Speaking in someone else's session is joining it, so the same step that
  // attributes the message records its sender as a participant. `$addToSet`
  // makes the repeat on every later turn a no-op.
  if (fresh && actorId !== ownerId) await addConversationParticipants(sessionId, [actorId])
  if (fresh && last && teamId) await attachMentions(fresh, last, sessionId, teamId, actorId)

  restoreAppMessageMetadata(messages, stored, fresh)
}

/** The composer's mention chips, as ids on the client's metadata, become trusted mentions. */
async function attachMentions(
  fresh: MessageMetadata,
  message: UIMessage,
  sessionId: string,
  teamId: string,
  actorId: string,
) {
  const claimed = (message.metadata as { mentions?: unknown } | undefined)?.mentions
  const [mentions, conversation] = await Promise.all([
    resolveMentions(teamId, claimed, actorId),
    getConversationBySessionId(sessionId),
  ])

  if (mentions.length > 0) fresh.mentions = mentions
  // A brand-new conversation has no one else in it to tell yet.
  if (conversation?.teamId !== teamId) return
  const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')

  void noteMentions({ ...conversation, teamId }, { id: message.id, text, metadata: fresh }).catch(
    (error: unknown) => {
      logError('agent.mentions.note_failed', error, { session_id: sessionId })
    },
  )
}
