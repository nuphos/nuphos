#!/usr/bin/env bun
// One-off for #3743, run once before the backend with the Personal Credential
// gate deploys. A conversation's personalCredentialIds list was saved before
// Google could be selected, and Google was handed out regardless of it. This
// adds the owner's own Google grants in that team to each unarchived list that
// lacks them, so those conversations keep Gmail / Drive / Calendar under the
// connector rule. The current backend ignores the list for Google, so running
// it early changes nothing. Archived ones follow the rule as is.
//
// Runs from a backend pod before its image carries it: copied into
// /app/scripts, it uses that pod's config and database. Dry run unless --apply; $addToSet,
// so a second run adds nothing. Before writing, --apply saves what it will add
// to each conversation in --record (default /tmp), so a $pull of exactly those
// ids undoes it.

import { writeFile } from 'node:fs/promises'

import { closeDb, connectDb } from '../src/lib/db'

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
  const db = await connectDb()

  try {
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
    const plan: { sessionId: string; userId: string; added: string[] }[] = []

    for (const conversation of conversations) {
      const add = missingGoogle(
        grants,
        String(conversation.userId),
        conversation.teamId ? String(conversation.teamId) : undefined,
        (conversation.credentialAccess as { personalCredentialIds: string[] })
          .personalCredentialIds,
      )

      if (!add.length) continue
      for (const id of add) added[id] = (added[id] ?? 0) + 1
      plan.push({
        sessionId: String(conversation.sessionId),
        userId: String(conversation.userId),
        added: add,
      })
    }
    if (apply) {
      const at = process.argv.indexOf('--record')
      const record =
        at >= 0
          ? process.argv[at + 1]
          : `/tmp/tick-own-google-credentials-${String(Date.now())}.json`

      await writeFile(record, JSON.stringify(plan, null, 1))
      console.log(`rollback record: ${record}`)
      for (const { sessionId, userId, added: ids } of plan) {
        await db
          .collection('agent_conversations')
          .updateOne(
            { sessionId, userId },
            { $addToSet: { 'credentialAccess.personalCredentialIds': { $each: ids } } },
          )
      }
    }
    console.log(
      `${apply ? 'done' : 'dry-run'}: ${apply ? 'ticked' : 'would tick'} ${String(plan.length)} of ` +
        `${String(conversations.length)} unarchived conversation(s) with a list, from ` +
        `${String(owners.length)} member(s); ids ${JSON.stringify(added)}`,
    )
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
