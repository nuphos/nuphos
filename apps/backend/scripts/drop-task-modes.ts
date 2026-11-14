#!/usr/bin/env bun
// One-off for #2577: a Task under a Bot now runs in its topmost parent's
// permission mode and no longer reads the mode stored for itself. This lists
// every Task that still has a stored mode, marks the ones whose mode differs
// from the parent's, and with --apply deletes those leftover rows so one cannot
// come back into effect if the Task is later moved out from under its parent.
// The Task's effective mode already changed when the backend was deployed;
// --apply only removes what is no longer read. Dry run unless --apply is passed.

import { agentConversations, credentialSource } from '../src/lib/agent/db'
import { closeDb, connectDb, db } from '../src/lib/db'

const name = (bypass: boolean) => (bypass ? 'Full Access' : 'Auto Mode')

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')

  await connectDb()
  try {
    const modes = db().collection<{ conversationId: string; userId: string; bypass?: boolean }>(
      'auto_mode_authorizations',
    )
    const stored = async (conversationId: string, userId: string) =>
      modes.findOne({ conversationId, userId }, { projection: { bypass: 1 } })
    const tasks = await agentConversations()
      .find({ parentSessionId: { $exists: true } })
      .toArray()
    let leftover = 0
    let widened = 0
    let narrowed = 0

    for (const task of tasks) {
      const parent = await credentialSource(task)

      if (parent.sessionId === task.sessionId) continue
      const own = await stored(task.sessionId, task.userId)

      if (!own) continue
      leftover += 1
      const was = own.bypass === true
      const now = (await stored(parent.sessionId, parent.userId))?.bypass === true

      if (was !== now) {
        if (now) widened += 1
        else narrowed += 1
        console.log(
          `${task.sessionId}${task.archivedAt ? ' (archived)' : ''} under ${parent.sessionId}: ` +
            `was ${name(was)}, runs in ${name(now)}`,
        )
      }
      if (apply) await modes.deleteOne({ conversationId: task.sessionId, userId: task.userId })
    }
    console.log(
      `${apply ? 'done' : 'dry-run'}: ${leftover} of ${tasks.length} Task(s) ${apply ? 'had' : 'have'} a stored mode; ` +
        `${widened} moved to Full Access and ${narrowed} to Auto Mode with their parent`,
    )
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
