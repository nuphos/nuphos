// The Personal and Team dashboards screens (#2988) in the app, against the real backend.
// The app is signed in as the team's owner, its Administrator.
import { agentEvents } from './agent-log.ts'
import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Dashboard = { id: string; name: string; visibility?: string; cadence?: string | null }

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
  const link = page.getByRole('link', { name: /\/dashboards$/ }).first()

  await link.click()

  return link
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

      const link = await openDashboardsPage(page, stack)
      const formerSection = page.getByRole('heading', {
        name: 'Personal dashboards of former members',
      })

      await formerSection.waitFor()
      await page.getByRole('heading', { name: 'Personal', exact: true }).waitFor()
      await page.getByRole('heading', { name: 'Team', exact: true }).waitFor()
      await shot(page, '1-list')

      // A new dashboard opens, and the backend has it as Personal.
      await page.getByRole('button', { name: 'New dashboard', exact: true }).click()
      await page.getByText('This dashboard is empty.').waitFor()
      await expectVisibility(stack, 'New dashboard', 'personal')
      await shot(page, '2-new-dashboard')
      // Refresh and auto-refresh on the dashboard itself, in the panel beside the chat (#3821).
      await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor()
      await page.getByTitle('Auto-refresh is off').click()
      await page.getByRole('menuitem', { name: /^Daily at/ }).click()
      await until('"New dashboard" to refresh daily on the backend', async () => {
        const dashboard = await ownersDashboard(stack, 'New dashboard')

        return dashboard?.cadence === 'daily'
      })
      await page.getByTitle(/^Daily at/).waitFor()
      await shot(page, '2b-refresh-controls')
      // The toolbar's Personal / Team menu, shown wherever the dashboard is open.
      await page.getByRole('button', { name: 'Personal', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Team', exact: true }).waitFor()
      await shot(page, '3-toolbar-menu')
      await page.getByRole('menuitem', { name: 'Team', exact: true }).click()
      await expectVisibility(stack, 'New dashboard', 'team')
      await page.getByRole('button', { name: 'Team', exact: true }).waitFor()
      await shot(page, '3b-toolbar-team')
      await page.getByRole('button', { name: 'Team', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Personal', exact: true }).click()
      await expectVisibility(stack, 'New dashboard', 'personal')
      await page.getByRole('button', { name: 'Personal', exact: true }).waitFor()

      // Back in the list, its row menu moves it to Team and back to Personal.
      await link.click()
      await formerSection.waitFor()
      const row = page.getByRole('row', { name: /New dashboard/ })

      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Move to Team' }).waitFor()
      await shot(page, '4-row-menu-personal')
      await page.getByRole('menuitem', { name: 'Move to Team' }).click()
      await expectVisibility(stack, 'New dashboard', 'team')
      await page.waitForTimeout(500)
      await shot(page, '5-list-team')
      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Move to Personal' }).waitFor()
      await shot(page, '6-row-menu-team')
      await page.getByRole('menuitem', { name: 'Move to Personal' }).click()
      await expectVisibility(stack, 'New dashboard', 'personal')
      await page.waitForTimeout(500)
      await shot(page, '7-list-personal-again')

      // The former member's dashboard: the Administrator moves it to Team.
      await page.getByRole('row', { name: /Release health/ }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Move to Team' }).waitFor()
      await shot(page, '8-former-member-menu')
      await page.getByRole('menuitem', { name: 'Move to Team' }).click()
      await formerSection.waitFor({ state: 'hidden' })
      await expectVisibility(stack, 'Release health', 'team')
      await shot(page, '9-former-member-moved')
    },
  },
]
