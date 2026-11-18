// Named to run after bot-settings: it moves the Bot between runtimes, which clears its model.
// #3308: a Bot whose computer is offline says so in its chat with the same strip a Task shows
// above its composer, not a line of its own.
import { randomUUID } from 'node:crypto'

import { botPresence, computerWithUsage, pickRuntime } from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'
import { newTask } from '../ui.ts'

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
      const strip = page.getByText('Its computer is offline.', { exact: true })

      await strip.waitFor({ timeout: 60_000 })
      await page.screenshot({ path: `${artifacts}/presence-offline-banner-light.png` })
      // The same strip on a Task on that computer, for comparison.
      await newTask(page)
      await pickRuntime(page, computer, /^Claude Code/)
      await strip.waitFor({ timeout: 60_000 })
      await page.screenshot({ path: `${artifacts}/presence-offline-task-light.png` })
      // A new Task starts on the runtime picked last: leave it on one that runs.
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
    } finally {
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
      disconnect()
    }
  },
} satisfies Scenario
