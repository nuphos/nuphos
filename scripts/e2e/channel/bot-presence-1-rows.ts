// #3308: a Bot's row says whether it can reply now; a Task's row says nothing of it. By now the
// chat scenarios have left a Task open and the E2E Bot idle on the fixture agent.
import assert from 'node:assert/strict'

import { botPresence, isBotRow, listedConversations } from '../channel-helpers.ts'

import type { Scenario } from '../ui.ts'

export default {
  name: "a Bot's row says it is online, and a Task's row says nothing of presence",
  run: async (_page, stack) => {
    const tasks = (await listedConversations(stack)).filter(
      (row) => !isBotRow(row) && row.kind !== 'channel',
    )

    assert.deepEqual(await botPresence(stack), { state: 'online' })
    assert.ok(tasks.length > 0 && tasks.every((row) => row.presence === undefined))
  },
} satisfies Scenario
