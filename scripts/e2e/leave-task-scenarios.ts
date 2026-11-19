// A teammate's Task, hidden from your own list without archiving it for them (#3681).
// The teammate sets things up through the API; the signed-in person leaves in the app.
import { randomUUID } from 'node:crypto'

import { joinTeam } from './dashboard-scenarios.ts'
import { bothMenus, listed, rest, rowOf, stillGoneAfterReload } from './leave-helpers.ts'
import { artifacts, until } from './processes.ts'
import {
  invite,
  laptopOnline,
  myId as me,
  onLaptop,
  say,
  sharedTask,
} from './shared-task-helpers.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const TASK = 'E2E shared Task to leave'
const PRIVATE_TASK = 'E2E private Task to leave'
const LAPTOP = 'e2e-leave-task-laptop'

/** Leaves the teammate's Task from its row, once Cancel has backed out; gone for me only. */
async function leaveFromRow(
  page: Page,
  stack: Stack,
  ownerToken: string,
  { sessionId, title, shot }: { sessionId: string; title: string; shot?: string },
) {
  const row = rowOf(page, title)

  await row.waitFor({ timeout: 30_000 })
  const offered = shot ? await bothMenus(page, row, title, shot) : []

  // Archive is offered beside it, and archives it for me alone (archive-shared-task-scenarios.ts).
  if (shot && offered.slice(-2).join('|') !== 'Leave task|Archive Task')
    throw new Error(`A teammate's Task offers ${offered.join(', ')}`)
  const ask = page.getByRole('alertdialog', { name: 'Leave this task?' })
  const choose = async () => {
    if (!(await page.getByRole('menuitem').count())) await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Leave task' }).click()
    await ask.waitFor()
  }

  await choose()
  if (shot) await page.screenshot({ path: `${artifacts}/${shot}-confirm.png` })
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await ask.waitFor({ state: 'detached' })
  await row.waitFor()
  await choose()
  await ask.getByRole('button', { name: 'Leave task' }).click()
  await row.waitFor({ state: 'detached', timeout: 15_000 })
  if (shot) await page.screenshot({ path: `${artifacts}/${shot}-gone.png` })
  await until('the server to drop the Task from my shared list', async () =>
    (await listed(stack, stack.token, 'shared')).every((id) => id !== sessionId),
  )
  // Its owner still has it, not archived.
  if (!(await listed(stack, ownerToken, 'mine')).includes(sessionId))
    throw new Error('The owner lost the Task when a teammate left it')
}

export const leaveTaskScenarios: Scenario[] = [
  {
    name: "a teammate's Task is left from its row's two menus after a confirmation, only for you",
    // My message waits for the offline computer, and the private Task refuses and hides itself.
    expected:
      /queued_launch_failed|"error_code":"conversation_read_only"|"path":"\/agent\/conversations\/[\w-]+","status":404/,
    run: async (page, stack) => {
      const teammate = await joinTeam(stack, 'task-owner')
      const myId = await me(stack)
      // On the teammate's computer, which I may use.
      const usable = await sharedTask(stack, teammate.token, TASK)
      const goOffline = await laptopOnline(stack, teammate.token, LAPTOP)
      const rejoin = randomUUID()

      try {
        await rest(stack, teammate.token)(
          'PUT',
          `/agent/devices/${LAPTOP}/share?teamId=${stack.teamId}`,
          { level: 'full', everyone: false, userIds: [myId], managerIds: [] },
        )
        onLaptop(stack, usable, teammate.id, LAPTOP)
        await invite(stack, teammate.token, usable, myId)
        // On no computer of mine to use, and private: leaving it ends my access.
        const closed = await sharedTask(stack, teammate.token, PRIVATE_TASK)

        await invite(stack, teammate.token, closed, myId)
        // Offline from here, so my message waits for the computer rather than running.
        goOffline()
        // Each reload loads the app's modules again, so the scenario reloads only twice.
        await page.reload()
        await page.getByRole('tab', { name: 'Tasks' }).click()
        await leaveFromRow(page, stack, teammate.token, {
          sessionId: usable,
          title: TASK,
          shot: 'leave-task',
        })
        await leaveFromRow(page, stack, teammate.token, { sessionId: closed, title: PRIVATE_TASK })
        const refused = await say(stack, closed, teammate.token, 'Let me back E2E_DELIVERY:closed')

        if (refused < 400)
          throw new Error(`My message in a Task I lost was taken: ${String(refused)}`)
        const read = await fetch(
          `${stack.apiUrl}/agent/conversations/${closed}?teamId=${stack.teamId}`,
          { headers: { authorization: `Bearer ${stack.token}` } },
        )

        if (read.ok) throw new Error('I can still read a private Task after leaving it')
        // I may still reply in the other, so speaking in it joins me again, as the dialog says.
        await say(stack, usable, teammate.token, 'Back again E2E_DELIVERY:leave-task-rejoin', {
          id: rejoin,
        })
        await until('the new message to bring the Task back to my shared list', async () =>
          (await listed(stack, stack.token, 'shared')).includes(usable),
        )
        if ((await listed(stack, stack.token, 'shared')).includes(closed))
          throw new Error('A private Task I may not use came back')
        // After the sidebar reads the server again: the one I rejoined is back, the other stays gone.
        await stillGoneAfterReload(page, 'Tasks', PRIVATE_TASK)
        await rowOf(page, TASK).waitFor({ timeout: 30_000 })
        await page.screenshot({ path: `${artifacts}/leave-task-rejoined.png` })
      } finally {
        goOffline()
        // My message waits for the offline computer; I take it back.
        await rest(stack, stack.token)(
          'DELETE',
          `/agent/conversations/${usable}/queue/${rejoin}?teamId=${stack.teamId}`,
        ).catch((error: unknown) => {
          console.warn(`Could not take back my waiting message: ${String(error)}`)
        })
        // Shared, it would be another computer for me in later scenarios.
        await rest(stack, teammate.token)(
          'PUT',
          `/agent/devices/${LAPTOP}/share?teamId=${stack.teamId}`,
          { level: 'off', everyone: false, userIds: [] },
        ).catch((error: unknown) => {
          console.warn(`Could not unshare the laptop: ${String(error)}`)
        })
      }
      // Nothing of mine is left waiting: dropped later, it would note so in the Task and move its
      // row under a later scenario's pointer (#3910).
      const { messages } = await rest(stack, teammate.token)<{ messages: unknown[] }>(
        'GET',
        `/agent/conversations/${usable}/queue?teamId=${stack.teamId}`,
      )

      if (messages.length > 0) throw new Error(`${String(messages.length)} message(s) still wait`)
    },
  },
]
