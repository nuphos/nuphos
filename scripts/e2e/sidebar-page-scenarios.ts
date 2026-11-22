// Scenarios about switching the sidebar's pages.
import { must } from './binding-access-scenarios.ts'
import { screencast } from './question-scenarios.ts'

import type { Scenario } from './ui.ts'

export const sidebarPageScenarios: Scenario[] = [
  {
    // #3540: switching to Bots showed its New Bot page for a frame before the Bot opened.
    name: 'switching to Bots goes straight to its Bot, never through the New Bot page',
    run: async (page) => {
      // Watches every render, so even one frame of the New Bot page counts.
      await page.evaluate(() => {
        const seen = window as unknown as { sawNewBot?: boolean }
        const check = () => {
          const shown = [
            ...document.querySelectorAll('main.workspace-content-surface:not(.hidden) h1'),
          ].some((heading) => /^(New Bot|Start with your first Bot)$/.test(heading.textContent))

          if (shown) seen.sawNewBot = true
        }

        seen.sawNewBot = false
        new MutationObserver(check).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        })
      })
      const recording = await screencast(page, 'bots-page-switch')

      for (let round = 0; round < 3; round++) {
        // Tasks with nothing open: its New task page.
        await page.getByRole('tab', { name: 'Tasks' }).click()
        await page.getByRole('button', { name: 'New task', exact: true }).click()
        await page.waitForTimeout(400)
        await page.getByRole('tab', { name: 'Bots' }).click()
        await page.locator('[data-sidebar-row]').filter({ hasText: 'Fold Bot' }).first().waitFor()
        await page.waitForTimeout(600)
      }
      await recording()
      must(
        !(await page.evaluate(() => (window as unknown as { sawNewBot?: boolean }).sawNewBot)),
        'switching to Bots not to show the New Bot page on the way to its Bot',
      )
    },
  },
]
