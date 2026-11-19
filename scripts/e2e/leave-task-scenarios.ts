// A Task a teammate shares with you, hidden from your own list without archiving it for them (#3681).
import { randomUUID } from 'node:crypto'

import { api, joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const TITLE = 'E2E shared Task to leave'

/** The Task ids one person lists in a scope, archived ones left out as the sidebar does. */
async function listed(stack: Stack, token: string, scope: 'mine' | 'shared'): Promise<string[]> {
  const query = new URLSearchParams({ teamId: stack.teamId, scope, archived: 'exclude' })
  const response = await fetch(`${stack.apiUrl}/agent/conversations?${String(query)}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const page = (await response.json()) as { conversations?: { sessionId: string }[] }

  return (page.conversations ?? []).map((conversation) => conversation.sessionId)
}

export const leaveTaskScenarios: Scenario[] = [
  {
    name: "a teammate's Task shared with you is left from its row, and only you stop seeing it",
    run: async (page, stack) => {
      const teammate = await joinTeam(stack, 'task-owner')
      const as = api(stack, teammate.token)
      const me = (await api(stack, stack.token)('GET', '/auth/me')).body as {
        id?: string
        user?: { id: string }
      }
      const myId = me.user?.id ?? me.id ?? ''
      const sessionId = randomUUID()
      const created = await as('PUT', `/agent/conversations/${sessionId}/transcript`, {
        teamId: stack.teamId,
        title: TITLE,
        messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: TITLE }] }],
      })

      if (created.status !== 200)
        throw new Error(`the teammate's Task was not created: ${String(created.status)}`)
      const invited = await as('POST', `/agent/conversations/${sessionId}/participants`, {
        teamId: stack.teamId,
        userIds: [myId],
      })

      if (invited.status >= 300)
        throw new Error(`the Task was not shared with me: ${String(invited.status)}`)
      await page.reload()
      await page.getByRole('tab', { name: 'Tasks' }).click()
      const row = page.locator('aside [data-sidebar-row]').filter({ hasText: TITLE }).first()

      await row.waitFor({ timeout: 30_000 })
      await row.click({ button: 'right' })
      const leave = page.getByRole('menuitem', { name: 'Leave task' })

      await leave.waitFor()
      // Archive would hide it for its owner too, so it is not offered.
      if ((await page.getByRole('menuitem', { name: 'Archive Task' }).count()) > 0)
        throw new Error("A teammate's Task offers Archive Task to someone who does not own it")
      await page.screenshot({ path: `${artifacts}/leave-task-menu.png` })
      await leave.click()
      await row.waitFor({ state: 'detached', timeout: 15_000 })
      await page.screenshot({ path: `${artifacts}/leave-task-gone.png` })
      await until('the server to drop the Task from my shared list', async () =>
        (await listed(stack, stack.token, 'shared')).every((id) => id !== sessionId),
      )
      // Still gone after the sidebar reads the server again.
      await page.reload()
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await page.getByRole('button', { name: 'New task', exact: true }).waitFor()
      await page.waitForTimeout(2000)
      if ((await page.locator('aside [data-sidebar-row]').filter({ hasText: TITLE }).count()) > 0)
        throw new Error('The Task I left came back after a reload')
      // Its owner still has it, not archived.
      if (!(await listed(stack, teammate.token, 'mine')).includes(sessionId))
        throw new Error('The owner lost the Task when a teammate left it')
    },
  },
]
