// #3427: the model chip opens one picker, the effort card, whether or not the Task has started.
import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { pickAgent } from './runtime-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** Opens the model chip, captures the whole window in light theme, and says whether the effort card opened. */
async function openChip(page: Page, shot: string) {
  await page.getByRole('button', { name: /^Model settings/ }).click()
  const slider = page.getByRole('slider')

  await slider.or(page.getByRole('menu')).first().waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${artifacts}/${shot}-light.png` })
  const effortCard = await slider.isVisible()

  await page.keyboard.press('Escape')

  return effortCard
}

// A Task whose effort was never picked used to get a bare model list once it started.
export const effortCardScenarios: Scenario[] = [
  {
    name: 'a Task opens the same effort card before it starts and during its first reply',
    run: async (page, stack) => {
      const stopOffering = stack.offerDefaultStandIn()
      const theme = await page.evaluate(() => {
        const previous = document.documentElement.className

        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')

        return previous
      })

      try {
        await newTask(page)
        await pickAgent(page, 'E2E fixture agent')
        if (!(await openChip(page, 'effort-card-new-task')))
          throw new Error('A new Task opened a model list, not the effort card')
        await send(page, 'Hold on E2E_HOLD E2E_DELIVERY:effort-held')
        await until('the held turn to start', async () =>
          agentEvents(stack).includes('start E2E_DELIVERY:effort-held'),
        )
        const started = await openChip(page, 'effort-card-started-task')

        await page.locator('button[title="Stop"]').click()
        await until('the held turn to be cancelled', async () =>
          agentEvents(stack).includes('cancelled E2E_DELIVERY:effort-held'),
        )
        if (!started) throw new Error('A started Task opened a model list, not the effort card')
      } finally {
        stopOffering()
        await page.evaluate((previous) => {
          document.documentElement.className = previous
        }, theme)
      }
    },
  },
]
