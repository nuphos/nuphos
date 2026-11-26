// A Bot chat in a split pane (#2990): its header has the pane's close button, as a Task's does.
// Needs the Bot "E2E Bot", created earlier in the run.
import { until } from './processes.ts'
import { newTask, openRow, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const splitPaneScenarios: Scenario[] = [
  {
    name: 'split the window beside a Bot chat, and close the Bot chat’s pane from its header',
    run: async (page) => {
      const close = page.getByRole('button', { name: 'Close pane' })
      const expectClose = (when: string, count: number) =>
        until(
          `${String(count)} close buttons ${when}`,
          async () => (await close.count()) === count,
          10_000,
        )

      // The Task's reply, where it is on screen, shows which chat a pane is on. Panes kept
      // mounted in the background hold hidden copies.
      const reply = page.locator('text="ACK E2E_DELIVERY:split" >> visible=true').first()

      await newTask(page)
      await send(page, 'Beside a Bot E2E_DELIVERY:split')
      await reply.waitFor()
      // The Bot chat alone in the window: no pane to close.
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.getByText('E2E Bot', { exact: true }).filter({ visible: true }).first().click()
      await reply.waitFor({ state: 'hidden' })
      await expectClose('not split', 0)
      // Split, with the Task in the new pane: both panes can be closed from their headers.
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+d')
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await openRow(page, 'Beside a Bot E2E_DELIVERY:split')
      await reply.waitFor()
      await expectClose('split beside the Bot chat', 2)
      // The Bot chat's pane is first; its own button closes it and leaves the Task.
      await close.first().click()
      await reply.waitFor()
      await expectClose('after closing the Bot chat’s pane', 0)
    },
  },
]
