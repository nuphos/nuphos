// #4505: the sidebar's Tasks tab after a switch of workspace, in the app against the real backend.
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'

export const teamSwitchTasksScenarios: Scenario[] = [
  {
    // Right after the dashboards scenarios, whose last Task in E2E opened a page of "No agent E2E".
    // Back in E2E, the Tasks tab reopens that Task and must keep the app in E2E.
    name: 'the Tasks tab stays in the workspace switched back to',
    expected: /"path":"\/agent\/conversations\/[\w-]+","status":404/,
    run: async (page) => {
      const switcher = page.getByRole('button', { name: /^\S*\s*(?:E2E|No agent E2E)$/ }).first()
      const team = async () => String(await switcher.textContent()).trim()

      await switcher.click()
      await page.getByRole('menuitem', { name: 'Switch workspace' }).click()
      await page.getByRole('menuitem', { name: /^\S*\s*E2E$/ }).click()
      await until('the app to show E2E', async () => !(await team()).includes('No agent'))
      await page.getByRole('tab', { name: 'Tasks' }).click()
      // The switch back came about 100 ms after the click.
      await page.waitForTimeout(2000)
      await page.screenshot({ path: `${artifacts}/tasks-tab-after-switch.png` })
      if ((await team()).includes('No agent'))
        throw new Error('The Tasks tab took the app back to "No agent E2E"')
    },
  },
]
