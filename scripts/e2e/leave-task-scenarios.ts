// A teammate's Task, hidden from your own list without archiving it for them (#3681).
// The teammate sets things up through the API; the signed-in person leaves in the app.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { joinTeam } from './dashboard-scenarios.ts'
import { bothMenus, listed, rest, rowOf, stillGoneAfterReload } from './leave-helpers.ts'
import { artifacts, until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const TASK = 'E2E shared Task to leave'
const PRIVATE_TASK = 'E2E private Task to leave'
const LAPTOP = 'e2e-leave-task-laptop'
const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Runs `script` against the database; it reads its arguments from process.argv. */
function inDatabase(mongoUri: string, script: string, ...args: string[]) {
  const run = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const db = client.db('nuphos_e2e')
    ${script}
    await client.close()`

  execFileSync('bun', ['-e', run, mongoUri, ...args], { cwd: BACKEND_DIR, timeout: 10_000 })
}

// The teammate's computer, online until the returned function is called. No agent runs turns
// on it; what matters is that they shared it with me, so I may reply in a Task on it.
async function laptopOnline(stack: Stack, token: string): Promise<() => void> {
  await rest(stack, token)('PUT', '/agent/devices', {
    deviceId: LAPTOP,
    label: 'E2E leave-task laptop',
    platform: 'darwin',
    allowLocalExec: true,
  })
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${LAPTOP}/runtime-tunnel`,
    { headers: { authorization: `Bearer ${token}` } } as unknown as string[],
  )

  tunnel.addEventListener('message', () => tunnel.send(JSON.stringify({ t: 'pong' })))
  await new Promise((opened, failed) => {
    tunnel.addEventListener('open', opened)
    tunnel.addEventListener('error', failed)
  })
  tunnel.send(
    JSON.stringify({
      t: 'status',
      status: { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } },
    }),
  )

  return () => tunnel.close()
}

/** Speaking in a Task joins it, before any computer takes the turn; offline, the turn waits. */
async function say(stack: Stack, sessionId: string, ownerToken: string, text: string) {
  const { messages } = await rest(stack, ownerToken)<{ messages: unknown[] }>(
    'GET',
    `/agent/conversations/${sessionId}?teamId=${stack.teamId}`,
  )
  const response = await fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: sessionId,
      teamId: stack.teamId,
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
      streamId: randomUUID(),
      baseIndex: messages.length,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  await response.body?.cancel()

  return response.status
}

/** The teammate's Task, written as the app syncs a transcript. */
async function sharedTask(stack: Stack, ownerToken: string, title: string) {
  const as = rest(stack, ownerToken)
  const sessionId = randomUUID()

  await as('PUT', `/agent/conversations/${sessionId}/transcript`, {
    teamId: stack.teamId,
    title,
    messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: title }] }],
  })

  return sessionId
}

const invite = (stack: Stack, ownerToken: string, sessionId: string, myId: string) =>
  rest(stack, ownerToken)('POST', `/agent/conversations/${sessionId}/participants`, {
    teamId: stack.teamId,
    userIds: [myId],
  })

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

  // Archive would hide it for its owner too, so it is not offered.
  if (shot && (!offered.includes('Leave task') || offered.some((l) => l.startsWith('Archive'))))
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
      const me = await rest(stack, stack.token)<{ id?: string; user?: { id: string } }>(
        'GET',
        '/auth/me',
      )
      const myId = me.user?.id ?? me.id ?? ''
      const goOffline = await laptopOnline(stack, teammate.token)

      try {
        await rest(stack, teammate.token)(
          'PUT',
          `/agent/devices/${LAPTOP}/share?teamId=${stack.teamId}`,
          { level: 'full', everyone: false, userIds: [myId], managerIds: [] },
        )
        // On the teammate's computer, which I may use. The suite's agent is not that computer's,
        // so the Task is put there in the database.
        const usable = await sharedTask(stack, teammate.token, TASK)

        inDatabase(
          stack.mongoUri,
          `await db.collection('agent_conversations').updateOne({ sessionId: process.argv[2] },
            { $set: { runtimeId: process.argv[3], runtimeLabel: 'Claude Code' } })`,
          usable,
          `local_${teammate.id}_${LAPTOP}`,
        )
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
        await say(stack, usable, teammate.token, 'Back again E2E_DELIVERY:leave-task-rejoin')
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
        // Unshared, the computer no longer lets me reply, so my waiting message is dropped.
        await rest(stack, teammate.token)(
          'PUT',
          `/agent/devices/${LAPTOP}/share?teamId=${stack.teamId}`,
          { level: 'off', everyone: false, userIds: [] },
        ).catch((error: unknown) => {
          console.warn(`Could not unshare the laptop: ${String(error)}`)
        })
      }
    },
  },
]
