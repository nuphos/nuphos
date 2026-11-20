// The Personal and Team dashboards screens (#2988) in the app, against the real backend.
// The app is signed in as the team's owner, its Administrator.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { agentEvents } from './agent-log.ts'
import { api, joinTeam } from './dashboard-scenarios.ts'
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

const NO_RUNTIME = "Runtimes on your own computer can't run dashboard panels"

/** Records the panel's latest run as one no agent could take (#4168), the way the backend fails it. */
function failForNoAgent(stack: Stack, panelId: string) {
  const script = `
    import { MongoClient, ObjectId } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const snapshots = client.db('nuphos_e2e').collection('cost_panel_snapshots')
    const { _id, output, ...latest } = await snapshots
      .find({ panelId: new ObjectId(process.argv[2]) }).sort({ requestedAt: -1 }).limit(1).next()
    await snapshots.insertOne({
      ...latest,
      status: 'failed',
      error: { kind: 'no_runtime', message: process.argv[3] },
      requestedAt: new Date(Date.now() + 60_000),
      finishedAt: new Date(),
    })
    await client.close()`
  const message = `${NO_RUNTIME}. A team runtime or a computer from Nuphos can. Ask a team admin to rent one, then refresh.`

  execFileSync('bun', ['-e', script, stack.mongoUri, panelId, message], {
    cwd: resolve(import.meta.dirname, '../../apps/backend'),
    timeout: 10_000,
  })
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
      await page.getByRole('button', { name: 'Auto-refresh: Daily', exact: true }).waitFor()
      await page.getByTitle(/^Auto-refresh: Daily at/).waitFor()
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      // Nothing in the narrow panel runs past its edge (the panel is at the window's right).
      const addPanel = await page
        .getByRole('button', { name: 'Add Panel', exact: true })
        .boundingBox()
      const windowWidth = page.viewportSize()?.width ?? 0

      if (!addPanel || addPanel.x + addPanel.width > windowWidth)
        throw new Error(`Add Panel runs past the panel edge: ${JSON.stringify(addPanel)}`)
      await shot(page, '2b-refresh-controls')
      // The same toolbar on one row, with the panel expanded to the window.
      await page.getByRole('button', { name: 'Expand workspace panel' }).click()
      await page.getByRole('button', { name: 'Restore workspace panel' }).waitFor()
      await page.waitForTimeout(500)
      await shot(page, '2c-refresh-controls-expanded')
      await page.getByRole('button', { name: 'Restore workspace panel' }).click()
      await page.getByRole('button', { name: 'Expand workspace panel' }).waitFor()
      await page.waitForTimeout(500)
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
  {
    // #4168: a panel no agent could run said "bring one online" to someone whose agents were.
    name: 'a panel no agent can run says why, and offers an Administrator a Box',
    run: async (page, stack) => {
      const owner = api(stack, stack.token)
      const created = await owner('POST', `/teams/${stack.teamId}/dashboards`, {
        name: 'No agent',
        timeRange: {
          periodStart: new Date(Date.now() - 7 * 86_400_000).toISOString(),
          periodEnd: new Date().toISOString(),
        },
        visibility: 'team',
      })
      const panel = await owner(
        'POST',
        `/teams/${stack.teamId}/dashboards/${String(created.body.id)}/panels`,
        {
          title: 'Spend',
          kind: 'scalar',
          code: 'export default async () => ({ kind: "scalar", title: "Spend", value: 1 })',
        },
      )

      if (!panel.body.id) throw new Error(`No panel: ${String(panel.status)}`)
      failForNoAgent(stack, panel.body.id)
      await openDashboardsPage(page, stack)

      // The name cell's button opens it; a click elsewhere on the row only selects it.
      await page
        .getByRole('row', { name: /No agent/ })
        .getByRole('button', { name: /No agent/ })
        .click()
      await page.getByText(NO_RUNTIME).waitFor()
      await shot(page, '10-no-agent-panel')
      await page.getByRole('button', { name: 'Rent a computer from Nuphos', exact: true }).click()
      await page.getByRole('dialog').getByText('Rent a computer from Nuphos').first().waitFor()
      await shot(page, '11-no-agent-rent-box')
      // Opened on this step, the dialog has nothing to go back to.
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    },
  },
  {
    // #4168: a member reads the backend's words, no button; the open Task 404s in the new team.
    name: 'a member sees why no agent can run a panel, and is sent to a team admin',
    expected: /dashboard\.panel\.exec_failed|"path":"\/agent\/conversations\/[\w-]+","status":404/,
    run: async (page, stack) => {
      const anonymous = api(stack, '')
      const email = `e2e-no-agent-${String(Date.now())}@example.com`

      await anonymous('POST', '/auth/email/request-code', { email })
      await until('the sign-in code to be logged', async () => stack.signInCode(email))
      const signedIn = await anonymous('POST', '/auth/email/verify-code', {
        email,
        code: stack.signInCode(email),
      })
      const admin = api(stack, String(signedIn.body.token))
      const made = await admin('POST', '/teams', { name: 'No agent E2E' })
      const teamId = String((made.body as { team?: { id: string } }).team?.id)
      const invited = await admin('POST', `/teams/${teamId}/invitations`, {
        inviteeEmail: stack.email,
      })

      await api(stack, stack.token)(
        'POST',
        `/invitations/${String(invited.body.invitation?.id)}/accept`,
      )
      const created = await admin('POST', `/teams/${teamId}/dashboards`, {
        name: 'No agent here',
        timeRange: {
          periodStart: new Date(Date.now() - 86_400_000).toISOString(),
          periodEnd: new Date().toISOString(),
        },
        visibility: 'team',
      })
      const dashboardId = String(created.body.id)

      // Its first run finds no agent at all, so the backend fails it as no_runtime itself.
      await admin('POST', `/teams/${teamId}/dashboards/${dashboardId}/panels`, {
        title: 'Spend',
        kind: 'scalar',
        code: 'export default async () => ({ kind: "scalar", title: "Spend", value: 1 })',
      })
      await newTask(page)
      await send(
        page,
        `Open https://nuphos.ai/teams/${teamId}/dashboards/${dashboardId} E2E_DELIVERY:no-agent-member`,
      )
      await until('the agent to read the link', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:no-agent-member'),
      )
      await page
        .getByRole('link', { name: new RegExp(`${dashboardId}$`) })
        .first()
        .click()
      // The app learned its teams before joining this one, as a member's would.
      await page.getByRole('button', { name: 'Reload workspaces' }).click()
      await page.getByText('Ask a team admin to rent one, then refresh.').waitFor()
      if ((await page.getByRole('button', { name: 'Rent a computer from Nuphos' }).count()) > 0)
        throw new Error('A member was offered a computer to rent')
      await shot(page, '12-no-agent-member')
    },
  },
]
