// #3308: a post to a Bot whose computer is offline says so where its reply will appear.
import { randomUUID } from 'node:crypto'

import { botPresence, computerWithUsage, pickRuntime } from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'
import { send } from '../ui.ts'

import type { Scenario } from '../ui.ts'

export default {
  name: 'a post to a Bot whose computer is offline says it will reply once the computer is back',
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
      await send(page, 'While its computer is away E2E_DELIVERY:presence-away')
      await page
        .getByText('E2E Bot’s computer is offline. It will reply when the computer is back.')
        .waitFor({ timeout: 30_000 })
      await page.screenshot({ path: `${artifacts}/presence-offline-line-light.png` })
    } finally {
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
      disconnect()
    }
  },
} satisfies Scenario
