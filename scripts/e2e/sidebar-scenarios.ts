// Scenarios about the sidebar itself.
import { must } from './binding-access-scenarios.ts'
import { captureTabStrip, checkDockToggleClear } from './chat-presentation.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const sidebarScenarios: Scenario[] = [
  {
    // The pages' viewport was `overflow: hidden`, which focus still scrolls: every page showed cut off.
    name: 'every sidebar page shows from its left edge, never scrolled sideways',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Hello E2E_DELIVERY:sidebar')
      await page.getByText('ACK E2E_DELIVERY:sidebar').waitFor()
      await checkDockToggleClear(page, 'Task chat')
      await captureTabStrip(page)
      for (const tab of ['Tasks', 'Inbox', 'Bots']) {
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${artifacts}/sidebar-${tab.toLowerCase()}.png` })
        const sideways = await page.evaluate(
          () => document.querySelector('.sidebar-swipe-viewport')?.scrollLeft,
        )

        must(sideways === 0, `the ${tab} page not to be scrolled sideways, got ${String(sideways)}`)
      }
    },
  },
]
