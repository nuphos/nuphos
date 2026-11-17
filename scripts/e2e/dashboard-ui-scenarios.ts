// Evidence only: the Dashboards page before #3257, for its before and after captures.
import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${artifacts}/dashboards-${name}.png` })

export const dashboardUiScenarios: Scenario[] = [
  {
    name: 'the Dashboards page before personal dashboards (evidence only)',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, `Open https://nuphos.ai/teams/${stack.teamId}/dashboards E2E_DELIVERY:dashboards`)
      await until('the agent to read the link', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:dashboards'),
      )
      const link = page.getByRole('link', { name: /\/dashboards$/ }).first()

      await link.click()
      await page.getByRole('button', { name: 'New dashboard', exact: true }).waitFor()
      await page.waitForTimeout(1_500)
      await shot(page, 'before-1-list')
      await page.getByRole('button', { name: 'New dashboard', exact: true }).click()
      await page.waitForTimeout(3_000)
      await shot(page, 'before-2-header')
      await link.click()
      await page.waitForTimeout(1_500)
      const row = page.getByRole('row', { name: /New dashboard/ }).first()

      await row.click({ button: 'right' })
      await page.waitForTimeout(1_000)
      await shot(page, 'before-3-row-menu')
    },
  },
]
