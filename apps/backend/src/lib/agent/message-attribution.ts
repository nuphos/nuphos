import { trustedAvatarURL } from '../identity/avatar-url'

import { addConversationParticipants } from './db/participants'
import { agentMessages } from './db/shared'
import { assertSingleNewUserMessage } from './message-input'
import { restoreAppMessageMetadata, parseMessageMetadata } from './message-metadata'

import type { MessageMetadata } from './message-metadata'
import type { UIMessage } from 'ai'

import { getNuphosUserById } from '@/lib/identity/auth'

export async function createMessageMetadata(
  userId: string,
  source: MessageMetadata['source'],
): Promise<MessageMetadata> {
  const user = await getNuphosUserById(userId)

  return {
    version: 1,
    sender: {
      type: 'user',
      id: userId,
      displayName: user?.name || user?.username || userId,
      ...(trustedAvatarURL(user?.avatarURL)
        ? { avatarURL: trustedAvatarURL(user?.avatarURL) }
        : {}),
    },
    source,
    sentAt: new Date().toISOString(),
  }
}

/** Client history is not a source of verified attribution. Restore it by ID. */
export async function attributeAppMessages(
  messages: UIMessage[],
  sessionId: string,
  ownerId: string,
  actorId: string,
  continuation: boolean,
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
      ? await createMessageMetadata(actorId, 'nuphos')
      : undefined

  // Speaking in someone else's session is joining it, so the same step that
  // attributes the message records its sender as a participant. `$addToSet`
  // makes the repeat on every later turn a no-op.
  if (fresh && actorId !== ownerId) await addConversationParticipants(sessionId, [actorId])

  restoreAppMessageMetadata(messages, stored, fresh)
}
