// #3427: the model chip opens one picker, with the effort slider, whether or not the Task has started.
import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** Opens the model chip, captures the whole window in light theme, and says whether the effort slider shows. */
async function openChip(page: Page, shot: string) {
  await page.getByRole('button', { name: /^Model settings/ }).click()
  const effortCard = await page
    .getByRole('slider')
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)

  await page.waitForTimeout(500)
  await page.screenshot({ path: `${artifacts}/${shot}-light.png` })

  await page.keyboard.press('Escape')

  return effortCard
}

// A Task whose effort was never picked used to get a bare model list once it started.
export const effortCardScenarios: Scenario[] = [
  {
    name: 'a Task opens the same picker, with effort, before it starts and during its first reply',
    run: async (page, stack) => {
      const stopOffering = stack.offerDefaultStandIn()
      const theme = await page.evaluate(() => {
        const previous = document.documentElement.className

        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')

        return previous
      })

      // Error toasts left by earlier scenarios stack over a started Task's chip, each over
      // the last one's button, so each is told to close directly. One can close on its own
      // first, so this clicks whichever are still there until none is.
      const dismiss = '[data-base-ui-portal] button[aria-label="Dismiss"]'

      await page.waitForFunction((selector) => {
        for (const button of document.querySelectorAll<HTMLButtonElement>(selector)) button.click()
        return !document.querySelector(selector)
      }, dismiss)
      try {
        await newTask(page)
        await pickAgent(page, 'E2E fixture agent')
        if (!(await openChip(page, 'effort-card-new-task')))
          throw new Error('A new Task opened the picker without its effort slider')
        await send(page, 'Hold on E2E_HOLD E2E_DELIVERY:effort-held')
        await until('the held turn to start', async () =>
          agentEvents(stack).includes('start E2E_DELIVERY:effort-held'),
        )
        const started = await openChip(page, 'effort-card-started-task')

        await page.locator('button[title="Stop"]:visible').click()
        await until('the held turn to be cancelled', async () =>
          agentEvents(stack).includes('cancelled E2E_DELIVERY:effort-held'),
        )
        if (!started) throw new Error('A started Task opened the picker without its effort slider')
      } finally {
        stopOffering()
        await page.evaluate((previous) => {
          document.documentElement.className = previous
        }, theme)
      }
    },
  },
]
