#!/usr/bin/env bun
// One-off for #3743, run once before the backend with the Personal Credential
// gate deploys. A conversation's personalCredentialIds list was saved before
// Google could be selected, and Google was handed out regardless of it. This
// adds the owner's own Google grants in that team to each unarchived list that
// lacks them, so those conversations keep Gmail / Drive / Calendar under the
// connector rule. The current backend ignores the list for Google, so running
// it early changes nothing. Archived ones follow the rule as is.
//
// Needs only MONGODB_URI (and MONGODB_DB, default atlas), so it runs from a
// backend pod before its image carries it. Dry run unless --apply; $addToSet,
// so a second run adds nothing.

import { MongoClient } from 'mongodb'

const GOOGLE = ['gmail', 'google-drive', 'google-calendar']

/** `userId:teamId` → the Google providers that member connected in that team. */
export type Grants = Map<string, string[]>

/** The Google providers `owner` connected in `teamId` that `listed` does not have yet. */
export function missingGoogle(
  grants: Grants,
  owner: string,
  teamId: string | undefined,
  listed: string[],
): string[] {
  if (!teamId) return []

  return (grants.get(`${owner}:${teamId}`) ?? []).filter((id) => !listed.includes(id))
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const uri = process.env.MONGODB_URI

  if (!uri) throw new Error('MONGODB_URI is required')
  const client = await new MongoClient(uri).connect()

  try {
    const db = client.db(process.env.MONGODB_DB ?? 'atlas')
    const grants: Grants = new Map()

    for (const grant of await db
      .collection('personal_credentials')
      .find({ provider: { $in: GOOGLE }, teamId: { $exists: true } })
      .toArray()) {
      const key = `${String(grant.userId)}:${String(grant.teamId)}`

      grants.set(key, [...(grants.get(key) ?? []), String(grant.provider)])
    }
    const owners = [...new Set([...grants.keys()].map((key) => key.split(':')[0]))]
    const conversations = await db
      .collection('agent_conversations')
      .find(
        {
          userId: { $in: owners },
          archivedAt: { $exists: false },
          'credentialAccess.personalCredentialIds': { $type: 'array' },
        },
        { projection: { sessionId: 1, userId: 1, teamId: 1, credentialAccess: 1 } },
      )
      .toArray()
    const added: Record<string, number> = {}
    let ticked = 0

    for (const conversation of conversations) {
      const add = missingGoogle(
        grants,
        String(conversation.userId),
        conversation.teamId ? String(conversation.teamId) : undefined,
        (conversation.credentialAccess as { personalCredentialIds: string[] })
          .personalCredentialIds,
      )

      if (!add.length) continue
      ticked += 1
      for (const id of add) added[id] = (added[id] ?? 0) + 1
      if (!apply) continue
      await db
        .collection('agent_conversations')
        .updateOne(
          { sessionId: conversation.sessionId, userId: conversation.userId },
          { $addToSet: { 'credentialAccess.personalCredentialIds': { $each: add } } },
        )
    }
    console.log(
      `${apply ? 'done' : 'dry-run'}: ${apply ? 'ticked' : 'would tick'} ${String(ticked)} of ` +
        `${String(conversations.length)} unarchived conversation(s) with a list, from ` +
        `${String(owners.length)} member(s); ids ${JSON.stringify(added)}`,
    )
  } finally {
    await client.close()
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
