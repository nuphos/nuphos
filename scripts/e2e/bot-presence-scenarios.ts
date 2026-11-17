// A Bot's presence in the conversation list (#3308). Run after the chat scenarios, which leave
// a Task open and the E2E Bot on the fixture agent.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { computerWithUsage, pickRuntime } from './channel-scenarios.ts'
import { until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Row = { title?: string; avatar?: unknown; kind?: string; presence?: unknown }

async function rows(stack: Stack): Promise<Row[]> {
  const response = await fetch(`${stack.apiUrl}/agent/conversations?teamId=${stack.teamId}`, {
    headers: { authorization: `Bearer ${stack.token}` },
  })

  return ((await response.json()) as { conversations: Row[] }).conversations
}

const isBot = (row: Row) => Boolean(row.avatar) && row.kind !== 'channel'

/** The E2E Bot's presence as the conversation list reports it. */
async function botPresence(stack: Stack) {
  return (await rows(stack)).find((row) => row.title === 'E2E Bot' && isBot(row))?.presence
}

export const botPresenceScenarios: Scenario[] = [
  {
    name: "a Bot's row says it is online, and a Task's row says nothing of presence",
    run: async (_page, stack) => {
      const listed = await rows(stack)
      const tasks = listed.filter((row) => !isBot(row) && row.kind !== 'channel')

      assert.deepEqual(await botPresence(stack), { state: 'online' })
      assert.ok(tasks.length > 0 && tasks.every((row) => row.presence === undefined))
    },
  },
  {
    name: 'a Bot on a computer that goes offline reads offline with why, then online once back',
    run: async (page, stack) => {
      const computer = 'E2E presence computer'
      const deviceId = randomUUID()
      const is = (label: string, want: unknown) =>
        until(`the Bot's presence to be ${label}`, async () => {
          assert.deepEqual(await botPresence(stack), want)

          return true
        })
      let disconnect = await computerWithUsage(stack, computer, deviceId)

      try {
        await page.getByRole('tab', { name: 'Bots' }).click()
        await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
        await pickRuntime(page, computer, /^Claude Code/)
        await is('online', { state: 'online' })
        disconnect(false)
        await is('offline', { state: 'offline', reason: 'computer_offline' })
        disconnect = await computerWithUsage(stack, computer, deviceId)
        await is('online again', { state: 'online' })
        await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
      } finally {
        disconnect()
      }
    },
  },
]
