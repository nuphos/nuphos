#!/usr/bin/env bun
// One-off for #4158, run once after the backend that gives a new Bot its owner's
// default selection deploys. A Bot made with "+", create_bot or an import before
// then stored no credentialAccess, so it could use no computer and no cloud
// account. This gives each unarchived Bot that never had a selection written the
// same default a new Bot now gets: everything its owner may use right now, with
// Resend and Trello left opt-in. A Bot whose owner saved a selection, even an
// empty one, is left as it is.
//
// Runs from a backend pod before its image carries it: copied into /app/scripts,
// it uses that pod's config and database. Dry run unless --apply. Each write
// matches only a still-unset selection, so a second run, or a selection saved in
// between, is left alone. --apply saves the session ids it wrote in --record
// (default /tmp), so `$unset: { credentialAccess: 1 }` on exactly those undoes it.

import { writeFile } from 'node:fs/promises'

import { closeDb, connectDb } from '../src/lib/db'

// A Bot is a conversation with a face that is not a chat (isBot in read-state.ts).
const NEVER_CHOSEN = {
  kind: { $ne: 'channel' },
  avatar: { $ne: null },
  teamId: { $exists: true },
  archivedAt: { $exists: false },
  credentialAccess: null,
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const db = await connectDb()

  try {
    const conversations = db.collection('agent_conversations')
    const bots = await conversations
      .find(NEVER_CHOSEN, { projection: { sessionId: 1, userId: 1, teamId: 1 } })
      .toArray()
    const plan = bots.map((bot) => ({
      sessionId: String(bot.sessionId),
      userId: String(bot.userId),
      teamId: String(bot.teamId),
    }))
    let written = 0

    if (apply) {
      const at = process.argv.indexOf('--record')
      const record =
        at >= 0 ? process.argv[at + 1] : `/tmp/default-bot-credentials-${String(Date.now())}.json`
      // Loaded only to write: a dry run also works on a backend without it yet.
      const { defaultCredentialAccess } = await import('../src/routes/agent/credential-access')
      // Only the Bots this run wrote, so undoing it never clears a choice saved in between.
      const done: typeof plan = []

      console.log(`rollback record: ${record}`)
      try {
        for (const bot of plan) {
          try {
            const credentialAccess = await defaultCredentialAccess(bot.teamId, bot.userId)
            const result = await conversations.updateOne(
              { sessionId: bot.sessionId, userId: bot.userId, ...NEVER_CHOSEN },
              { $set: { credentialAccess } },
            )

            if (result.modifiedCount) done.push(bot)
          } catch (err) {
            // An owner who left the team, say: that Bot stays as it is.
            console.error(
              `skipped ${bot.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      } finally {
        await writeFile(record, JSON.stringify(done, null, 1))
        written = done.length
      }
    }
    const outcome = apply ? `done: gave ${String(written)} of` : 'dry-run: would give'

    console.log(
      `${outcome} of ${String(plan.length)} unarchived Bot(s) with no selection their owner's ` +
        `default, from ${String(new Set(plan.map((bot) => bot.userId)).size)} owner(s)`,
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
