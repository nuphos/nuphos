// A Box whose machine instabox never builds (#4146): its owner is told to create it again.
import { join } from 'node:path'

import { instaboxCreates } from './instabox-stub.ts'
import { artifacts } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'

export const boxCreateScenarios: Scenario[] = [
  {
    // instabox held a create in its queue, then it failed: the Box goes, and says what to do.
    name: 'a Box instabox never builds is removed, and its owner is told to create it again',
    // Its failed order is logged, as it should be.
    expected: /provision_failed|no capacity/,
    run: async (page) => {
      instaboxCreates.failAfterMs = 8_000
      try {
        await openComputers(page)
        await page.getByRole('button', { name: 'Add computer' }).first().click()
        await page.getByRole('button', { name: /^Rent a computer from Nuphos/ }).click()
        await page.getByRole('button', { name: 'Create computer' }).click()
        await page
          .getByText(/could not start and was removed\. Try creating it again\./)
          .first()
          .waitFor({ timeout: 60_000 })
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'box-create-failed.png') })
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        instaboxCreates.failAfterMs = 0
      }
    },
  },
]
