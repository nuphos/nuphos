#!/usr/bin/env bun
// One-off for #3743: a member's own Gmail, Google Drive and Google Calendar grants
// are now handed out only to conversations that selected them. Until now every
// conversation the member owns in the grant's team got them, so this ticks them
// where they were reachable: each conversation with a stored selection (one
// without it already defaults to them), and each Trigger pinned to a
// `selected` scope (an `all` Trigger follows the default). Dry run unless --apply.

import { agentConversations } from '../src/lib/agent/db'
import { resolveTriggerCredentialMode } from '../src/lib/agent/trigger-credential-access'
import { agentTriggers } from '../src/lib/agent/trigger-db'
import { closeDb, connectDb } from '../src/lib/db'
import { isGoogleProvider } from '../src/lib/personal-credentials/google'
import { personalCredentials } from '../src/models'

/** `userId:teamId` → the Google providers that member connected in that team. */
export type Grants = Map<string, string[]>

/** The Google providers `owner` connected in `teamId` that `ticked` does not have yet. */
export function missingGoogle(
  grants: Grants,
  owner: string,
  teamId: string | undefined,
  ticked: string[] | undefined,
): string[] {
  if (!teamId) return []

  return (grants.get(`${owner}:${teamId}`) ?? []).filter((id) => !(ticked ?? []).includes(id))
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')

  await connectDb()
  try {
    const grants: Grants = new Map()

    for (const grant of await personalCredentials().find({}).toArray()) {
      if (!isGoogleProvider(grant.provider) || !grant.teamId) continue
      const key = `${grant.userId}:${grant.teamId}`

      grants.set(key, [...(grants.get(key) ?? []), grant.provider])
    }
    const owners = [...new Set([...grants.keys()].map((key) => key.split(':')[0]))]
    const conversations = await agentConversations()
      .find({
        userId: { $in: owners },
        credentialAccess: { $exists: true },
      })
      .toArray()
    let ticked = 0

    for (const conversation of conversations) {
      const add = missingGoogle(
        grants,
        conversation.userId,
        conversation.teamId,
        conversation.credentialAccess?.personalCredentialIds,
      )

      if (!add.length) continue
      ticked += 1
      if (!apply) continue
      await agentConversations().updateOne(
        { sessionId: conversation.sessionId, userId: conversation.userId },
        { $addToSet: { 'credentialAccess.personalCredentialIds': { $each: add } } },
      )
    }
    const triggers = await agentTriggers()
      .find({ userId: { $in: owners }, executionCredentialAccess: { $exists: true } })
      .toArray()
    let pinned = 0

    for (const trigger of triggers) {
      if (resolveTriggerCredentialMode(trigger) !== 'selected') continue
      const add = missingGoogle(
        grants,
        trigger.userId,
        trigger.teamId,
        trigger.executionCredentialAccess?.personalCredentialIds,
      )

      if (!add.length) continue
      pinned += 1
      if (!apply) continue
      await agentTriggers().updateOne(
        { _id: trigger._id },
        { $addToSet: { 'executionCredentialAccess.personalCredentialIds': { $each: add } } },
      )
    }
    console.log(
      `${apply ? 'done' : 'dry-run'}: ${String(grants.size)} member-team Google grant set(s); ` +
        `ticked ${String(ticked)} of ${String(conversations.length)} conversation(s), ` +
        `${String(pinned)} of ${String(triggers.length)} pinned Trigger(s)`,
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
