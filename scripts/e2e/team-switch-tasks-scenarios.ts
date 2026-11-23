// #4505: the sidebar's Tasks tab after a switch of workspace, in the app against the real backend.
import { api } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const switcher = (page: Page) =>
  page.getByRole('button', { name: /^\S*\s*(?:E2E|No agent E2E)$/ }).first()
const team = async (page: Page) => String(await switcher(page).textContent()).trim()

/** Switches back to E2E, whose Tasks tab reopens its last Task, which must keep the app in E2E. */
async function backToTasks(page: Page, shot: string) {
  await switcher(page).click()
  await page.getByRole('menuitem', { name: 'Switch team' }).click()
  await page.getByRole('menuitem', { name: /^\S*\s*E2E$/ }).click()
  await until('the app to show E2E', async () => !(await team(page)).includes('No agent'))
  await page.getByRole('tab', { name: 'Tasks' }).click()
  // The switch back came about 100 ms after the click.
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${artifacts}/${shot}.png` })
  if ((await team(page)).includes('No agent'))
    throw new Error('The Tasks tab took the app back to "No agent E2E"')
}

export const teamSwitchTasksScenarios: Scenario[] = [
  {
    // Right after the dashboards scenarios, whose last Task in E2E opened a page of "No agent E2E".
    name: 'the Tasks tab stays in the workspace switched back to',
    expected: /"path":"\/agent\/conversations\/[\w-]+","status":404/,
    run: async (page) => backToTasks(page, 'tasks-tab-after-switch'),
  },
  {
    // #4558: a link that opens the app in another team, as a web page's does, from that Task.
    name: 'a link into another team leaves the open Task to its own team',
    expected: /"path":"\/agent\/conversations\/[\w-]+","status":404/,
    run: async (page, stack, desktop) => {
      if (!desktop) throw new Error('This scenario opens a link in the app run.ts started')
      const { body } = await api(stack, stack.token)('GET', '/teams')
      const { teams } = body as unknown as { teams: { id: string; name: string }[] }
      const other = teams.find((candidate) => candidate.name === 'No agent E2E')

      await desktop.openDeepLink(`nuphos://open?path=/teams/${String(other?.id)}`)
      await until('the app to show No agent E2E', async () =>
        (await team(page)).includes('No agent'),
      )
      await backToTasks(page, 'tasks-tab-after-team-link')
    },
  },
]
