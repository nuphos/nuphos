// #3308: a Bot on a computer reads offline with why while the computer is away, online once back.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { botPresence, computerWithUsage, pickRuntime } from '../channel-helpers.ts'
import { until } from '../processes.ts'

import type { Scenario } from '../ui.ts'

export default {
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
} satisfies Scenario
