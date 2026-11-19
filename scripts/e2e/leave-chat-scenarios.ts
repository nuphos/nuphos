// A teammate's group chat, left from its row's two menus; the chat stays theirs.
import { joinTeam } from './dashboard-scenarios.ts'
import { bothMenus, listed, rest, rowOf, stillGoneAfterReload } from './leave-helpers.ts'
import { until } from './processes.ts'

import type { Scenario } from './ui.ts'

const GROUP = 'E2E group chat to leave'

export const leaveChatScenarios: Scenario[] = [
  {
    name: "a teammate's group chat is left from its row's two menus, and it stays theirs",
    run: async (page, stack) => {
      const teammate = await joinTeam(stack, 'group-owner')
      const as = rest(stack, teammate.token)
      const me = await rest(stack, stack.token)<{ id?: string; user?: { id: string } }>(
        'GET',
        '/auth/me',
      )
      const chat = await as<{ sessionId: string }>('POST', '/agent/channels', {
        teamId: stack.teamId,
        title: GROUP,
        group: true,
      })

      await as('POST', `/agent/conversations/${chat.sessionId}/participants`, {
        teamId: stack.teamId,
        userIds: [me.user?.id ?? me.id ?? ''],
      })
      await page.reload()
      await page.getByRole('tab', { name: 'Bots' }).click()
      const row = rowOf(page, GROUP)

      await row.waitFor({ timeout: 30_000 })
      const offered = await bothMenus(page, row, GROUP, 'leave-chat')

      if (!offered.includes('Leave chat') || offered.some((label) => label.startsWith('Archive')))
        throw new Error(`A teammate's group chat offers ${offered.join(', ')}`)
      await page.getByRole('menuitem', { name: 'Leave chat' }).click()
      await row.waitFor({ state: 'detached', timeout: 15_000 })
      await until('the server to drop the chat from my shared list', async () =>
        (await listed(stack, stack.token, 'shared', 'channel')).every(
          (id) => id !== chat.sessionId,
        ),
      )
      await stillGoneAfterReload(page, 'Bots', GROUP)
      if (!(await listed(stack, teammate.token, 'mine', 'channel')).includes(chat.sessionId))
        throw new Error('The owner lost the group chat when a member left it')
    },
  },
]
