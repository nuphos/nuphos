#!/usr/bin/env bun
// One-off for #2647: a Task under a Bot now uses its topmost parent's
// credentials and computers instead of its own selection. This adds the ids each
// open Task had selected to that parent. Archived Tasks are skipped.
// A field the parent leaves unset already reaches everything and is left alone.
// A field the Task leaves unset (for some connectors that means all of them) is
// not widened to everything on the parent, so such a Task is narrowed to the
// parent's list there. Dry run unless --apply is passed.

import { agentConversations, credentialSource } from '../src/lib/agent/db'
import { closeDb, connectDb } from '../src/lib/db'
import { normalizeCredentialAccess } from '../src/routes/agent-sessions/shared'

type Selection = ReturnType<typeof normalizeCredentialAccess>

/** The ids `task` has in each field that `parent` sets and does not have yet. */
export function missingFromParent(parent: Selection, task: Selection) {
  const added: Record<string, string[]> = {}

  for (const [key, ids] of Object.entries(parent) as [string, string[] | undefined][]) {
    const fromTask = task[key as keyof Selection] as string[] | undefined

    if (!ids || !fromTask) continue
    const fresh = fromTask.filter((id) => !ids.includes(id))

    if (fresh.length) added[key] = fresh
  }

  return added
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')

  await connectDb()
  try {
    const tasks = await agentConversations()
      .find({
        parentSessionId: { $exists: true },
        credentialAccess: { $exists: true },
        archivedAt: { $exists: false },
      })
      .toArray()
    let merged = 0

    for (const task of tasks) {
      const parent = await credentialSource(task)

      if (parent.sessionId === task.sessionId) continue
      const added = missingFromParent(
        normalizeCredentialAccess(parent.credentialAccess),
        normalizeCredentialAccess(task.credentialAccess),
      )

      if (!Object.keys(added).length) continue
      merged += 1
      console.log(
        `${apply ? 'add' : 'would add'} to ${parent.sessionId} from ${task.sessionId}: ` +
          JSON.stringify(added),
      )
      if (!apply) continue
      // $addToSet per field, so Tasks of the same parent add up and nothing is overwritten.
      await agentConversations().updateOne(
        { sessionId: parent.sessionId, userId: parent.userId },
        {
          $addToSet: Object.fromEntries(
            Object.entries(added).map(([key, ids]) => [`credentialAccess.${key}`, { $each: ids }]),
          ),
          $set: { 'credentialAccess.updatedAt': new Date() },
        },
      )
    }
    console.log(`${apply ? 'done' : 'dry-run'}: ${merged} of ${tasks.length} Task(s) added access`)
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
