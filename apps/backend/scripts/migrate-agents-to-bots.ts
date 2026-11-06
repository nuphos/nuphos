#!/usr/bin/env bun
// #1691: every unarchived, top-level agent conversation that is not a trigger
// run becomes a Bot, by storing the face it already shows. Dry run by default;
// pass --apply to write. Idempotent: each write re-checks every condition.

import { botMigrationFilter, derivedAvatar, lowerMedian } from '../src/lib/agent/bot-migration'
import { agentConversations } from '../src/lib/agent/db/shared'
import { closeDb, connectDb } from '../src/lib/db'

function parseArgs(): { apply: boolean } {
  const argv = process.argv.slice(2)

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: bun scripts/migrate-agents-to-bots.ts [--apply]')
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
    const conversations = agentConversations()
    const { avatar: _avatar, ...eligible } = botMigrationFilter
    const perTeam = (
      await conversations
        .aggregate<{ n: number }>([
          { $match: botMigrationFilter },
          { $group: { _id: '$teamId', n: { $sum: 1 } } },
        ])
        .toArray()
    )
      .map((row) => row.n)
      .sort((a, b) => a - b)

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          eligible: await conversations.countDocuments(eligible),
          alreadyHaveAvatar: await conversations.countDocuments({
            ...eligible,
            avatar: { $exists: true },
          }),
          toPromote: perTeam.reduce((sum, n) => sum + n, 0),
          teams: perTeam.length,
          perTeamMax: perTeam.at(-1) ?? 0,
          perTeamMedian: lowerMedian(perTeam),
        },
        null,
        2,
      ),
    )
    if (!apply) return

    let written = 0

    for await (const { sessionId } of conversations.find(botMigrationFilter, {
      projection: { sessionId: 1 },
    })) {
      const result = await conversations.updateOne(
        { ...botMigrationFilter, sessionId },
        { $set: { avatar: derivedAvatar(sessionId) } },
      )

      written += result.modifiedCount
    }
    console.log(`promoted ${String(written)}`)
  } finally {
    await closeDb()
  }
}

await main()
