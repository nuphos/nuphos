// Evidence for #2990: a Bot chat in a split pane, and closing that pane from its header.
// Needs the Bot "E2E Bot", created earlier in the run.
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${artifacts}/split-${name}.png` })

export const splitBotScenarios: Scenario[] = [
  {
    name: 'split the window beside a Bot chat, and close the Bot chat’s pane from its header',
    run: async (page) => {
      const close = page.getByRole('button', { name: 'Close pane' })

      await newTask(page)
      await send(page, 'Beside a Bot E2E_DELIVERY:split')
      await page.getByText('ACK E2E_DELIVERY:split').waitFor()
      // The Bot chat alone in the window.
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.getByText('E2E Bot', { exact: true }).first().click()
      await page.waitForTimeout(1_500)
      console.log(`close buttons, not split: ${String(await close.count())}`)
      await shot(page, '1-bot-not-split')
      // Split: the new pane shows the Task, the Bot chat stays in the first pane.
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+d')
      await page.waitForTimeout(1_000)
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await page.getByText('Beside a Bot E2E_DELIVERY:split').first().click()
      await page.waitForTimeout(1_500)
      const split = await close.count()

      console.log(`close buttons, split: ${String(split)}`)
      await shot(page, '2-split')
      if (split < 2) return
      // The first pane is the Bot chat's: its own close button closes it.
      await close.first().hover()
      await page.waitForTimeout(800)
      await shot(page, '3-close-hover')
      await close.first().click()
      await page.waitForTimeout(1_500)
      const after = await close.count()

      console.log(`close buttons, after closing: ${String(after)}`)
      if (after !== 0) throw new Error(`the window is still split: ${String(after)} close buttons`)
      await shot(page, '4-closed')
    },
  },
]
