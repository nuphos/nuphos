// Buttons that manage computers open Settings › Computers, not a separate page (#4327).
import { join } from 'node:path'

import { artifacts } from './processes.ts'
import { newTask } from './ui.ts'

import type { Page } from 'playwright-core'
import type { Scenario } from './ui.ts'

async function expectComputersInSettings(page: Page, shot: string) {
  await page.getByText('Back to app', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Search runtimes' }).waitFor()
  // The list loads after the frame.
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(artifacts, shot) })
  await page.getByText('Back to app', { exact: true }).click()
  await page.getByText('Back to app', { exact: true }).waitFor({ state: 'detached' })
}

export const computersEntryScenarios: Scenario[] = [
  {
    name: 'managing computers from a chat or after making one opens Settings › Computers',
    run: async (page) => {
      await newTask(page)
      await page.getByRole('button', { name: /^Runtime:/ }).click()
      await page.getByRole('menuitem', { name: 'Manage computers and runtimes' }).click()
      await expectComputersInSettings(page, 'computers-entry-runtime-menu.png')

      // What onboarding sends once a new user's cloud computer is made.
      await page.evaluate(() => window.dispatchEvent(new Event('nuphos:open-computers')))
      await expectComputersInSettings(page, 'computers-entry-new-computer.png')
    },
  },
]
