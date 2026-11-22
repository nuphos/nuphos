// Who sees what of a team's activity (#3251): every member sees the whole team's
// rows and numbers; only an administrator sees the titles of others' sessions.
// Two people in a team of their own, so no earlier scenario's cached scan answers.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { must } from './binding-access-scenarios.ts'
import { api } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Page } from 'playwright-core'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const TEAM_NAME = 'Activity team'

type Activity = { members: { id: string }[]; sessions: { id: string; title: string | null }[] }

/** One session per member that ran a turn an hour ago, as only the database can set up here. */
function seedSessions(stack: Stack, teamId: string, sessions: Record<string, string>) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, teamId, json] = process.argv.slice(1)
    const ranAt = Date.now() - 60 * 60_000
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    for (const [userId, title] of Object.entries(JSON.parse(json))) {
      const sessionId = 'activity-' + userId
      await db.collection('agent_conversations').insertOne({
        sessionId, teamId, userId, title, generalAccess: 'team',
        createdAt: new Date(ranAt), lastActiveAt: new Date(ranAt + 60_000),
      })
      await db.collection('agent_messages').insertMany([
        { userId, sessionId, messageId: sessionId + '-0', index: 0, role: 'user', createdAt: new Date(ranAt) },
        { userId, sessionId, messageId: sessionId + '-1', index: 1, role: 'assistant', createdAt: new Date(ranAt + 60_000) },
      ])
    }
    await client.close()`

  execFileSync('bun', ['-e', script, stack.mongoUri, teamId, JSON.stringify(sessions)], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
}

const titles = (activity: Activity) =>
  Object.fromEntries(activity.sessions.map((s) => [s.id, s.title]))

/** The team switcher: its name is the team icon's initials, then the team's name. */
const switcher = (page: Page) =>
  page.getByRole('button', { name: new RegExp(`^\\S*\\s*(E2E|${TEAM_NAME})$`) }).first()

/** Hovers the busy cell in the row whose name has `who`, until its tooltip lists `title`, and shoots it. */
async function shootCell(page: Page, who: string, title: string, file: string) {
  const row = page.locator('div.h-7').filter({ hasText: who })
  const cells = row.locator('.grid > div')
  const count = await cells.count()

  // An open tooltip can cover the row above it, so let it close first.
  await page.mouse.move(0, 0)
  await page.waitForTimeout(800)

  // The session ran an hour ago, so its cell is one of the last few.
  for (let i = count - 1; i >= Math.max(0, count - 4); i--) {
    await cells.nth(i).hover()
    const shown = page.getByText(title, { exact: true })

    const opened = await shown.waitFor({ timeout: 1_500 }).then(
      () => true,
      () => false,
    )

    if (opened) {
      await page.screenshot({ path: `${artifacts}/${file}` })

      return
    }
  }
  throw new Error(`No cell of ${who} lists "${title}"`)
}

export const teamActivityScenarios: Scenario[] = [
  {
    name: "a member sees the whole team's activity and stats, with only their own sessions titled",
    run: async (page, stack) => {
      // The teammate signs in and makes a team, so the app's own person joins it as a member.
      const anonymous = api(stack, '')
      const email = `e2e-activity-${String(Date.now())}@example.com`

      await anonymous('POST', '/auth/email/request-code', { email })
      await until('the sign-in code to be logged', async () => stack.signInCode(email))
      const signedIn = await anonymous('POST', '/auth/email/verify-code', {
        email,
        code: stack.signInCode(email),
      })
      const admin = api(stack, String(signedIn.body.token))
      const member = api(stack, stack.token)
      const created = (await admin('POST', '/teams', { name: TEAM_NAME })).body as {
        team?: { id: string }
      }
      const teamId = String(created.team?.id)
      const invited = await admin('POST', `/teams/${teamId}/invitations`, {
        inviteeEmail: stack.email,
      })
      const accepted = await member(
        'POST',
        `/invitations/${String(invited.body.invitation?.id)}/accept`,
      )

      must(accepted.status < 300, `the app's person to join, got ${String(accepted.status)}`)
      const people = (await admin('GET', `/teams/${teamId}/members`)).body.members ?? []
      const adminId = String(people.find((p) => p.email === email)?.id)
      const memberId = String(people.find((p) => p.email === stack.email)?.id)

      seedSessions(stack, teamId, { [adminId]: 'Admin plan', [memberId]: 'Member fix' })

      const asAdmin = (await admin('GET', `/teams/${teamId}/agent-activity?range=1d`))
        .body as unknown as Activity
      const asMember = (await member('GET', `/teams/${teamId}/agent-activity?range=1d`))
        .body as unknown as Activity
      const both = [adminId, memberId].sort((a, b) => a.localeCompare(b))
      const ids = (activity: Activity) =>
        activity.members.map((m) => m.id).sort((a, b) => a.localeCompare(b))

      must(
        JSON.stringify(ids(asAdmin)) === JSON.stringify(both),
        `the administrator to see both rows, got ${JSON.stringify(ids(asAdmin))}`,
      )
      must(
        JSON.stringify(titles(asAdmin)) ===
          JSON.stringify({
            [`activity-${adminId}`]: 'Admin plan',
            [`activity-${memberId}`]: 'Member fix',
          }),
        `the administrator to see every title, got ${JSON.stringify(titles(asAdmin))}`,
      )
      must(
        JSON.stringify(ids(asMember)) === JSON.stringify(both),
        `the member to see both rows, got ${JSON.stringify(ids(asMember))}`,
      )
      must(
        JSON.stringify(titles(asMember)) ===
          JSON.stringify({ [`activity-${adminId}`]: null, [`activity-${memberId}`]: 'Member fix' }),
        `the member to see only their own title, got ${JSON.stringify(titles(asMember))}`,
      )
      const stats = await member(
        'GET',
        `/teams/${teamId}/agent-stats?scope=team&range=7d&timeZone=UTC`,
      )

      must(stats.status === 200, `the member to read team stats, got ${String(stats.status)}`)

      // The member's home in that team: the activity card, the teammate's session unnamed.
      await switcher(page).click()
      await page.getByRole('menuitem', { name: 'Switch workspace' }).click()
      await page.getByRole('menuitem', { name: TEAM_NAME }).click()
      try {
        await page.getByRole('button', { name: 'Stats', exact: true }).click()
        await page
          .getByText('Team activity', { exact: true })
          .filter({ visible: true })
          .first()
          .waitFor()
        await page.waitForTimeout(1_000)
        await page.screenshot({ path: `${artifacts}/team-activity-member-home.png` })
        // The member's own session keeps its title; the teammate's is listed unnamed.
        await shootCell(
          page,
          stack.email.split('@')[0] ?? '',
          'Member fix',
          'team-activity-member-own-cell.png',
        )
        await shootCell(
          page,
          'e2e-activity',
          'Conversation',
          'team-activity-member-teammate-cell.png',
        )
        await page.mouse.move(0, 0)
        await page.getByRole('button', { name: 'Stats', exact: true }).click()
      } finally {
        await switcher(page).click()
        await page.getByRole('menuitem', { name: 'Switch workspace' }).click()
        await page.getByRole('menuitem', { name: /E2E$/ }).click()
      }
    },
  },
]
