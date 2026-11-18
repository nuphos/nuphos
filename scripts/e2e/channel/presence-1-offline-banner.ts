// Named to run after bot-settings: it moves the Bot between runtimes, which clears its model.
// #3308: a Bot whose computer is offline says so in its chat with the same strip a Task shows
// above its composer, not a line of its own.
import { randomUUID } from 'node:crypto'

import { botPresence, computerWithUsage, pickRuntime } from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'

import type { Scenario } from '../ui.ts'

export default {
  name: "a Bot whose computer is offline says so above its chat's composer, as a Task does",
  run: async (page, stack) => {
    const computer = 'E2E away computer'
    const disconnect = await computerWithUsage(stack, computer, randomUUID())

    try {
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await pickRuntime(page, computer, /^Claude Code/)
      disconnect(false)
      await until('the Bot to read as offline', async () => {
        const presence = (await botPresence(stack)) as { reason?: string } | undefined

        return presence?.reason === 'computer_offline'
      })
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.getByText('Its computer is offline.', { exact: true }).waitFor({ timeout: 60_000 })
      await page.screenshot({ path: `${artifacts}/presence-offline-banner-light.png` })
    } finally {
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
      disconnect()
    }
  },
} satisfies Scenario
