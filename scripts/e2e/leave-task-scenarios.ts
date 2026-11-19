// A teammate's Task or group chat, hidden from your own list without archiving it for them (#3681).
// The teammate sets things up through the API; the signed-in person leaves in the app.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Locator, Page } from 'playwright-core'

const TASK = 'E2E shared Task to leave'
const GROUP = 'E2E group chat to leave'
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

function rest(stack: Stack, token: string) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(stack.apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()

    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`)

    return (text ? JSON.parse(text) : {}) as T
  }
}

/** The ids one person lists, archived ones left out as the sidebar does. */
async function listed(
  stack: Stack,
  token: string,
  scope: 'mine' | 'shared',
  kind?: 'channel',
): Promise<string[]> {
  const query = new URLSearchParams({
    teamId: stack.teamId,
    scope,
    archived: 'exclude',
    ...(kind ? { kind } : {}),
  })
  const page = await rest(stack, token)<{ conversations?: { sessionId: string }[] }>(
    'GET',
    `/agent/conversations?${String(query)}`,
  )

  return (page.conversations ?? []).map((conversation) => conversation.sessionId)
}

/** The row's actions, opened from its More button and from a right-click, captured both ways. */
async function bothMenus(page: Page, row: Locator, title: string, shot: string) {
  const items = () => page.getByRole('menuitem').allTextContents()

  await row.hover()
  await row.getByRole('button', { name: `More actions for ${title}` }).click()
  await page.getByRole('menuitem').first().waitFor()
  const fromButton = await items()

  await page.screenshot({ path: `${artifacts}/${shot}-more-button.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem').first().waitFor({ state: 'detached' })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem').first().waitFor()
  const fromRightClick = await items()

  await page.screenshot({ path: `${artifacts}/${shot}-right-click.png` })
  if (fromButton.join('|') !== fromRightClick.join('|'))
    throw new Error(
      `The More button offers ${fromButton.join(', ')} but a right-click ${fromRightClick.join(', ')}`,
    )

  return fromButton
}

const rowOf = (page: Page, title: string) =>
  page.locator('aside [data-sidebar-row]').filter({ hasText: title }).first()

async function stillGoneAfterReload(page: Page, tab: string, title: string) {
  await page.reload()
  await page.getByRole('tab', { name: tab }).click()
  await page.waitForTimeout(2000)
  if ((await page.locator('aside [data-sidebar-row]').filter({ hasText: title }).count()) > 0)
    throw new Error(`"${title}" came back after a reload`)
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

  // Queued or not, the listing below is what says whether it joined me.
  console.log(`My message in the Task I left answered ${String(response.status)}`)
  await response.body?.cancel()
}

/** Leaves the teammate's Task from its row, checks it is gone only for me, then rejoins it. */
async function leaveAndRejoin(page: Page, stack: Stack, ownerToken: string, sessionId: string) {
  await page.reload()
  await page.getByRole('tab', { name: 'Tasks' }).click()
  const row = rowOf(page, TASK)

  await row.waitFor({ timeout: 30_000 })
  const offered = await bothMenus(page, row, TASK, 'leave-task')

  // Archive would hide it for its owner too, so it is not offered.
  if (!offered.includes('Leave task') || offered.some((label) => label.startsWith('Archive')))
    throw new Error(`A teammate's Task offers ${offered.join(', ')}`)
  await page.getByRole('menuitem', { name: 'Leave task' }).click()
  await row.waitFor({ state: 'detached', timeout: 15_000 })
  await page.screenshot({ path: `${artifacts}/leave-task-gone.png` })
  await until('the server to drop the Task from my shared list', async () =>
    (await listed(stack, stack.token, 'shared')).every((id) => id !== sessionId),
  )
  await stillGoneAfterReload(page, 'Tasks', TASK)
  // Its owner still has it, not archived.
  if (!(await listed(stack, ownerToken, 'mine')).includes(sessionId))
    throw new Error('The owner lost the Task when a teammate left it')

  // Speaking in it again is joining it again, as after leaving from the Share card.
  await say(stack, sessionId, ownerToken, 'Back again E2E_DELIVERY:leave-task-rejoin')
  await until('the new message to bring the Task back to my shared list', async () =>
    (await listed(stack, stack.token, 'shared')).includes(sessionId),
  )
  await page.reload()
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await rowOf(page, TASK).waitFor({ timeout: 30_000 })
  await page.screenshot({ path: `${artifacts}/leave-task-rejoined.png` })
}

export const leaveTaskScenarios: Scenario[] = [
  {
    name: "a teammate's Task is left from its row's two menus, only for you, and a new message rejoins it",
    run: async (page, stack) => {
      const teammate = await joinTeam(stack, 'task-owner')
      const as = rest(stack, teammate.token)
      const me = await rest(stack, stack.token)<{ id?: string; user?: { id: string } }>(
        'GET',
        '/auth/me',
      )
      const myId = me.user?.id ?? me.id ?? ''
      const goOffline = await laptopOnline(stack, teammate.token)

      try {
        await as('PUT', `/agent/devices/${LAPTOP}/share?teamId=${stack.teamId}`, {
          level: 'full',
          everyone: false,
          userIds: [myId],
          managerIds: [],
        })
        const sessionId = randomUUID()

        // The teammate's own Task on that computer, shared with me. It is written as the app
        // syncs a transcript, then put on the computer: the suite's agent is not this computer's.
        await as('PUT', `/agent/conversations/${sessionId}/transcript`, {
          teamId: stack.teamId,
          title: TASK,
          messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: TASK }] }],
        })
        inDatabase(
          stack.mongoUri,
          `await db.collection('agent_conversations').updateOne({ sessionId: process.argv[2] },
            { $set: { runtimeId: process.argv[3], runtimeLabel: 'Claude Code' } })`,
          sessionId,
          `local_${teammate.id}_${LAPTOP}`,
        )
        await as('POST', `/agent/conversations/${sessionId}/participants`, {
          teamId: stack.teamId,
          userIds: [myId],
        })
        // Shared now; offline from here, so my message waits for it rather than running.
        goOffline()
        await leaveAndRejoin(page, stack, teammate.token, sessionId)
      } finally {
        goOffline()
      }
    },
  },
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
