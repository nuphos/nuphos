// The Personal and Team dashboards screens (#2988) in the app, against the real backend.
// The app is signed in as the team's owner, its Administrator.
import { agentEvents } from './agent-log.ts'
import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Dashboard = { id: string; name: string; visibility?: string }

async function listed(stack: Stack, token: string) {
  const response = await fetch(`${stack.apiUrl}/teams/${stack.teamId}/dashboards`, {
    headers: { authorization: `Bearer ${token}` },
  })

  return (await response.json()) as { dashboards?: Dashboard[]; formerMembers?: Dashboard[] }
}

/** The owner's dashboard named `name`, as the backend has it. */
async function ownersDashboard(stack: Stack, name: string) {
  return (await listed(stack, stack.token)).dashboards?.find((d) => d.name === name)
}

async function expectVisibility(stack: Stack, name: string, visibility: string) {
  await until(`"${name}" to be ${visibility} on the backend`, async () => {
    const dashboard = await ownersDashboard(stack, name)

    return (dashboard?.visibility ?? 'team') === visibility
  })
}

/** Opens the Dashboards page the way a link in a chat does. */
async function openDashboardsPage(page: Page, stack: Stack) {
  const url = `https://nuphos.ai/teams/${stack.teamId}/dashboards`

  await newTask(page)
  await send(page, `Open ${url} E2E_DELIVERY:dashboards`)
  await until('the agent to read the link', async () =>
    agentEvents(stack).includes('finish E2E_DELIVERY:dashboards'),
  )
  await page.getByRole('link', { name: /\/dashboards$/ }).first().click()
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${artifacts}/dashboards-${name}.png` })

export const dashboardUiScenarios: Scenario[] = [
  {
    name: 'create a dashboard under Personal, move it to Team and back, and take over a former member’s',
    run: async (page, stack) => {
      // A member creates a personal dashboard and leaves; the Administrator sees it in its own section.
      const leaver = await joinTeam(stack, 'leaver')
      const created = await fetch(`${stack.apiUrl}/teams/${stack.teamId}/dashboards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${leaver.token}` },
        body: JSON.stringify({
          name: 'Release health',
          timeRange: {
            periodStart: new Date(Date.now() - 30 * 86_400_000).toISOString(),
            periodEnd: new Date().toISOString(),
          },
          visibility: 'personal',
        }),
      })

      if (created.status !== 201) throw new Error(`the leaver's dashboard: ${created.status}`)
      const removed = await fetch(`${stack.apiUrl}/teams/${stack.teamId}/members/${leaver.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${stack.token}` },
      })

      if (removed.status !== 204) throw new Error(`removing the leaver: ${removed.status}`)

      await openDashboardsPage(page, stack)
      const formerSection = page.getByRole('heading', {
        name: 'Personal dashboards of former members',
      })

      await formerSection.waitFor()
      await page.getByRole('heading', { name: 'Personal', exact: true }).waitFor()
      await page.getByRole('heading', { name: 'Team', exact: true }).waitFor()
      await shot(page, '1-list')

      // A new dashboard opens as Personal.
      await page.getByRole('button', { name: 'New dashboard', exact: true }).click()
      const chip = page.getByRole('button', { name: 'Personal', exact: true })

      await chip.waitFor()
      await expectVisibility(stack, 'New dashboard', 'personal')
      await chip.click()
      await page.getByRole('menuitem', { name: 'Team', exact: true }).waitFor()
      await shot(page, '2-header-menu')
      await page.getByRole('menuitem', { name: 'Team', exact: true }).click()
      await page.getByRole('button', { name: 'Team', exact: true }).waitFor()
      await expectVisibility(stack, 'New dashboard', 'team')
      await shot(page, '3-header-team')

      // Back in the list it is under Team; its row menu makes it personal again.
      await page.getByRole('button', { name: 'Custom boards' }).first().click()
      await formerSection.waitFor()
      const row = page.getByRole('row', { name: /New dashboard/ })

      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Move to Personal' }).waitFor()
      await shot(page, '4-row-menu')
      await page.getByRole('menuitem', { name: 'Move to Personal' }).click()
      await expectVisibility(stack, 'New dashboard', 'personal')
      await shot(page, '5-list-personal-again')

      // The former member's dashboard: the Administrator moves it to Team.
      await page.getByRole('row', { name: /Release health/ }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Move to Team' }).waitFor()
      await shot(page, '6-former-member-menu')
      await page.getByRole('menuitem', { name: 'Move to Team' }).click()
      await formerSection.waitFor({ state: 'hidden' })
      await expectVisibility(stack, 'Release health', 'team')
      await shot(page, '7-former-member-moved')
    },
  },
]
