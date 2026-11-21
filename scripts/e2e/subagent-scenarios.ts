// Throwaway: the same #1060 fixture turn rendered by main's UI, for a before shot.
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const subagentScenarios: Scenario[] = [
  {
    name: 'before: the sub-agent fixture turn on the pre-#4232 UI',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Look into billing E2E_SUBAGENT E2E_DELIVERY:subagent')
      await page.getByText('ACK E2E_DELIVERY:subagent').waitFor()
      await page
        .getByRole('button', { name: /^Worked for/ })
        .last()
        .click()
      const run = page.getByRole('button', { name: /calls/ }).last()

      await run.waitFor()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${artifacts}/subagent-before-collapsed.png` })
      await run.click()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${artifacts}/subagent-before-expanded.png` })
    },
  },
]
