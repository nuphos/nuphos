// A teammate's Task, archived for yourself alone, keeping access to it (#3686).
// The teammates set things up and speak through the API; the signed-in person archives in the app.
import { randomUUID } from 'node:crypto'

import { joinTeam } from './dashboard-scenarios.ts'
import { listed, rest, rowOf } from './leave-helpers.ts'
import { artifacts, until } from './processes.ts'
import { invite, laptopOnline, myId, onLaptop, say, sharedTask } from './shared-task-helpers.ts'

import type { Scenario } from './ui.ts'

const TASK = 'E2E shared Task to archive'
const LAPTOP = 'e2e-archive-task-laptop'

export const archiveSharedTaskScenarios: Scenario[] = [
  {
    name: "a teammate's Task is archived for you alone, and only your mention brings it back",
    // The owner's messages wait for their offline computer.
    expected: /queued_launch_failed/,
    run: async (page, stack) => {
      const owner = await joinTeam(stack, 'archive-task-owner')
      const member = await joinTeam(stack, 'archive-task-member')
      const me = await myId(stack)
      const goOffline = await laptopOnline(stack, owner.token, LAPTOP)
      const sessionId = await sharedTask(stack, owner.token, TASK)
      const posted: string[] = []
      const post = async (text: string, mentions?: string[]) => {
        const id = randomUUID()

        posted.push(id)
        const status = await say(stack, sessionId, owner.token, text, {
          as: owner.token,
          id,
          ...(mentions ? { mentions } : {}),
        })

        if (status >= 400) throw new Error(`The owner's message was refused: ${String(status)}`)
      }
      const mine = async () => (await listed(stack, stack.token, 'shared')).includes(sessionId)

      try {
        onLaptop(stack, sessionId, owner.id, LAPTOP)
        await invite(stack, owner.token, sessionId, me)
        await invite(stack, owner.token, sessionId, member.id)
        // Offline from here, so the owner's messages wait for the computer rather than running.
        goOffline()
        await page.reload()
        await page.getByRole('tab', { name: 'Tasks' }).click()
        const row = rowOf(page, TASK)

        await row.waitFor({ timeout: 30_000 })
        await row.hover()
        await row.getByRole('button', { name: `More actions for ${TASK}` }).click()
        const archive = page.getByRole('menuitem', { name: 'Archive Task' })

        await archive.waitFor()
        await page.screenshot({ path: `${artifacts}/archive-shared-task-menu.png` })
        await archive.click()
        await row.waitFor({ state: 'detached', timeout: 15_000 })
        await page.screenshot({ path: `${artifacts}/archive-shared-task-gone.png` })
        await until('the server to drop the Task from my list', async () => !(await mine()))
        // For me alone: the owner and the other member still list it, and I may still read it.
        if (!(await listed(stack, owner.token, 'mine')).includes(sessionId))
          throw new Error("Archiving a teammate's Task archived it for its owner")
        if (!(await listed(stack, member.token, 'shared')).includes(sessionId))
          throw new Error("Archiving a teammate's Task archived it for the other member")
        await rest(stack, stack.token)(
          'GET',
          `/agent/conversations/${sessionId}?teamId=${stack.teamId}`,
        )
        // The owner speaking in it is not a reason for it to come back to my list.
        await post('Status update E2E_DELIVERY:archive-owner')
        await page.waitForTimeout(3000)
        if (await mine()) throw new Error("The owner's message brought back a Task I archived")
        // My Archived lists it with my own, to restore.
        await page
          .getByRole('button', { name: /^Search/ })
          .first()
          .click()
        await page.keyboard.type('Archived')
        await page.getByRole('option', { name: 'Archived' }).first().click()
        await page.getByText(TASK, { exact: true }).waitFor({ timeout: 15_000 })
        await page.screenshot({ path: `${artifacts}/archive-shared-task-archived.png` })
        await page.getByText('Back to app', { exact: true }).click()
        // Being mentioned in it is.
        await post('Can you take a look? E2E_DELIVERY:archive-mention', [me])
        await until('the mention to bring the Task back to my list', mine)
        await rowOf(page, TASK).waitFor({ timeout: 30_000 })
        await page.screenshot({ path: `${artifacts}/archive-shared-task-back.png` })
      } finally {
        goOffline()
        // The owner's waiting messages go, so they are not retried into later scenarios.
        for (const id of posted)
          await rest(stack, owner.token)(
            'DELETE',
            `/agent/conversations/${sessionId}/queue/${id}?teamId=${stack.teamId}`,
          ).catch((error: unknown) => {
            console.warn(`Could not drop a waiting message: ${String(error)}`)
          })
      }
    },
  },
]
