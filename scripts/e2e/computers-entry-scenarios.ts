// Buttons that manage computers open Settings › Computers, not a separate page (#4327).
import { join } from 'node:path'

import { artifacts } from './processes.ts'
import { newTask, openBotTask } from './ui.ts'

import type { Locator, Page } from 'playwright-core'
import type { Scenario } from './ui.ts'

/** Settings › Computers is open; closing it leaves `behind` where it was. */
async function expectComputersInSettings(page: Page, shot: string, behind: Locator) {
  await page.getByText('Back to app', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Search runtimes' }).waitFor()
  // The list loads after the frame.
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(artifacts, shot) })
  await page.getByText('Back to app', { exact: true }).click()
  await page.getByText('Back to app', { exact: true }).waitFor({ state: 'detached' })
  await behind.waitFor()
}

async function manageFromRuntimeMenu(page: Page, within: Locator) {
  await within.getByRole('button', { name: /^Runtime:/ }).first().click()
  await page.getByRole('menuitem', { name: 'Manage computers and runtimes' }).click()
}

export const computersEntryScenarios: Scenario[] = [
  {
    name: 'managing computers from a task, a Bot task or after making one opens Settings › Computers',
    run: async (page) => {
      await newTask(page)
      const composer = page.getByRole('textbox', { name: 'Message' })

      await manageFromRuntimeMenu(page, page.locator('body'))
      await expectComputersInSettings(page, 'computers-entry-runtime-menu.png', composer)

      // What onboarding sends once a new user's cloud computer is made.
      await page.evaluate(() => window.dispatchEvent(new Event('nuphos:open-computers')))
      await expectComputersInSettings(page, 'computers-entry-new-computer.png', composer)

      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await page.getByText('Message E2E Bot', { exact: true }).waitFor()
      await openBotTask(page)
      const task = page.locator('.t-bot-task-mode')

      await task.getByRole('button', { name: 'Toggle task summary' }).waitFor()
      await manageFromRuntimeMenu(page, task)
      await expectComputersInSettings(page, 'computers-entry-bot-task.png', task)
    },
  },
]
