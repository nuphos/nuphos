import { join } from 'node:path'

import { LAPTOP, laptopOnline } from './laptop-fixture.ts'
import { artifacts, until } from './processes.ts'
import { newTask, pickInRow, pickInSubmenu } from './ui.ts'

import type { Scenario } from './ui.ts'

export const newTaskGreetingScenario: Scenario = {
  name: 'a wrapped computer notice leaves the New Task greeting clear',
  run: async (page, stack) => {
    const goOffline = await laptopOnline(stack, { diskPercent: 93 })
    const size = page.viewportSize()

    try {
      await newTask(page)
      await page.getByRole('button', { name: /^Runtime:/ }).click()
      await pickInRow(page, LAPTOP, /Claude Code/)
      const banner = page.getByRole('status').filter({ hasText: `${LAPTOP}’s disk is almost full` })

      await banner.waitFor()
      for (const width of [1280, 720]) {
        await page.setViewportSize({ width, height: 800 })
        await until('the notice to leave room below the New Task greeting', async () => {
          const greeting = page.locator('span[aria-label].font-semibold').first()
          const title = await greeting.boundingBox()
          const notice = await banner.boundingBox()

          return title && notice && notice.y >= title.y + title.height + 19
        })
        await page.screenshot({ path: join(artifacts, `new-task-notice-${String(width)}.png`) })
      }
      await page.getByRole('button', { name: /^Runtime:/ }).click()
      await page.getByRole('menu').getByText('E2E fixture agent').click()
      await pickInSubmenu(
        page,
        page.getByRole('menuitem', { name: /^E2E fixture agent.*Claude Code/ }),
      )
    } finally {
      if (size) await page.setViewportSize(size)
      goOffline()
    }
  },
}
