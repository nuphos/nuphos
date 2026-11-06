#!/usr/bin/env bun
// #1691: an agent conversation pinned by its owner becomes a Bot by storing the
// face it already shows. Dry run by default; pass --apply to write. Idempotent:
// only conversations still without an avatar are touched. Pins are left alone.

import { pinnedSessionId, planBotMigration } from '../src/lib/agent/bot-migration'
import { agentConversations } from '../src/lib/agent/db/shared'
import { closeDb, connectDb } from '../src/lib/db'
import { userTeamSidebarFavorites } from '../src/models/team'

import type { PinnedConversation } from '../src/lib/agent/bot-migration'

function parseArgs(): { apply: boolean } {
  const argv = process.argv.slice(2)

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: bun scripts/migrate-pinned-agents-to-bots.ts [--apply]')
    process.exit(0)
  }
  const unknown = argv.filter((arg) => arg !== '--apply')

  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`)

  return { apply: argv.includes('--apply') }
}

async function main(): Promise<void> {
  const { apply } = parseArgs()

  await connectDb()
  try {
    const favorites = (
      await userTeamSidebarFavorites()
        .find({}, { projection: { userId: 1, teamId: 1, entries: 1 } })
        .toArray()
    ).map((doc) => ({ userId: doc.userId, teamId: doc.teamId.toHexString(), entries: doc.entries }))
    const sessionIds = new Set(
      favorites.flatMap((doc) => doc.entries.map(pinnedSessionId).filter((id) => id !== null)),
    )
    const conversations = new Map<string, PinnedConversation>()

    for (const doc of await agentConversations()
      .find(
        { sessionId: { $in: [...sessionIds] } },
        { projection: { sessionId: 1, userId: 1, teamId: 1, kind: 1, avatar: 1, archivedAt: 1 } },
      )
      .toArray()) {
      conversations.set(doc.sessionId, doc as PinnedConversation)
    }

    const plan = planBotMigration(favorites, conversations)
    const existingBots = await agentConversations().countDocuments({
      avatar: { $exists: true },
      kind: { $ne: 'channel' },
    })
    const existingActiveBots = await agentConversations().countDocuments({
      avatar: { $exists: true },
      kind: { $ne: 'channel' },
      archivedAt: { $exists: false },
    })

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          favoritesDocs: favorites.length,
          ...plan.counts,
          conversationsWithAvatar: existingBots,
          conversationsWithAvatarUnarchived: existingActiveBots,
        },
        null,
        2,
      ),
    )
    if (!apply) return

    let written = 0

    for (const [sessionId, avatar] of plan.promote) {
      const result = await agentConversations().updateOne(
        { sessionId, avatar: { $exists: false }, archivedAt: { $exists: false } },
        { $set: { avatar } },
      )

      written += result.modifiedCount
    }
    console.log(`promoted ${written} of ${plan.promote.size}`)
  } finally {
    await closeDb()
  }
}

await main()
