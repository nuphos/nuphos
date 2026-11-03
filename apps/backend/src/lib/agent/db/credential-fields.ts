import { recordAgentEvent } from './events'
import { agentConversations, withTeamScope } from './shared'

import type { AgentConversation, AgentCredentialAccess } from './shared'

/**
 * Sets only the named selection fields, so a concurrent edit to the rest of the
 * selection (another category, local devices) is not overwritten.
 */
export async function setConversationCredentialFields(
  sessionId: string,
  userId: string,
  teamId: string,
  fields: Partial<AgentCredentialAccess>,
): Promise<AgentConversation | null> {
  const now = new Date()
  const result = await agentConversations().findOneAndUpdate(
    withTeamScope({ sessionId, userId }, teamId),
    {
      $set: {
        ...Object.fromEntries(
          Object.entries(fields).map(([key, ids]) => [`credentialAccess.${key}`, ids]),
        ),
        'credentialAccess.updatedAt': now,
        'credentialAccess.updatedBy': userId,
        lastActiveAt: now,
      },
    },
    { returnDocument: 'after' },
  )

  if (result) {
    recordAgentEvent({
      conversationId: sessionId,
      event: 'credentials.updated',
      userId,
      data: fields,
    })
  }

  return result
}

/**
 * Adds ids to the named selection fields in one atomic update, so concurrent
 * additions to the same field are all kept. A field in `existing` must still be
 * set: if it was cleared meanwhile (for some connectors, "all of them"), adding
 * would narrow it, so nothing is written and null is returned.
 */
export async function addConversationCredentialIds(
  sessionId: string,
  userId: string,
  teamId: string,
  fields: Partial<Record<keyof AgentCredentialAccess, string[]>>,
  existing: string[],
): Promise<AgentConversation | null> {
  const now = new Date()
  const result = await agentConversations().findOneAndUpdate(
    withTeamScope(
      {
        sessionId,
        userId,
        ...Object.fromEntries(
          existing.map((key) => [`credentialAccess.${key}`, { $exists: true }]),
        ),
      },
      teamId,
    ),
    {
      $addToSet: Object.fromEntries(
        Object.entries(fields).map(([key, ids]) => [`credentialAccess.${key}`, { $each: ids }]),
      ),
      $set: {
        'credentialAccess.updatedAt': now,
        'credentialAccess.updatedBy': userId,
        lastActiveAt: now,
      },
    },
    { returnDocument: 'after' },
  )

  if (result) {
    recordAgentEvent({
      conversationId: sessionId,
      event: 'credentials.updated',
      userId,
      data: fields,
    })
  }

  return result
}

const field = (key: string) => `credentialAccess.${key}`

/**
 * Removes ids from the named selection fields in one atomic update. `pull` drops
 * ids from fields that must still be lists; `narrow` sets fields that must still
 * be unset (for some connectors, "all of them") to the ids left after removal.
 * Unset is missing or null, as the driver stores undefined; `$eq: null` matches
 * both. If either guard fails, the selection changed meanwhile: nothing is
 * written and null is returned.
 */
export async function removeConversationCredentialIds(
  sessionId: string,
  userId: string,
  teamId: string,
  pull: Partial<Record<keyof AgentCredentialAccess, string[]>>,
  narrow: Partial<Record<keyof AgentCredentialAccess, string[]>>,
): Promise<AgentConversation | null> {
  const now = new Date()
  const guards: [string, Record<string, unknown>][] = [
    ...Object.keys(pull).map((key): [string, Record<string, unknown>] => [
      field(key),
      { $type: 'array' },
    ]),
    ...Object.keys(narrow).map((key): [string, Record<string, unknown>] => [
      field(key),
      { $eq: null },
    ]),
  ]
  const result = await agentConversations().findOneAndUpdate(
    withTeamScope(
      {
        sessionId,
        userId,
        ...Object.fromEntries(guards),
      },
      teamId,
    ),
    {
      ...(Object.keys(pull).length
        ? {
            $pull: Object.fromEntries(
              Object.entries(pull).map(([key, ids]) => [field(key), { $in: ids }]),
            ),
          }
        : {}),
      $set: {
        ...Object.fromEntries(Object.entries(narrow).map(([key, ids]) => [field(key), ids])),
        'credentialAccess.updatedAt': now,
        'credentialAccess.updatedBy': userId,
        lastActiveAt: now,
      },
    },
    { returnDocument: 'after' },
  )

  if (result) {
    recordAgentEvent({
      conversationId: sessionId,
      event: 'credentials.updated',
      userId,
      data: { removed: { ...pull }, ...narrow },
    })
  }

  return result
}
