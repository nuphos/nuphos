// Scenarios about a cloud computer (a Box) that instabox itself paused.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

import { backendLines, backendLog } from './backend-log.ts'
import { instaboxMachines } from './instabox-stub.ts'
import { artifacts, until } from './processes.ts'
import { newTask, openComputers, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const NOTICE = 'Paused by the provider (host out of memory). It resumes when you use it.'
const KILL_REFUSED =
  "Its machine on instabox couldn't be stopped and may still be running. Check your team's instabox account."

/** Writes or removes a Box row as the backend keeps it: only the database can make one here. */
export function boxRow(mongoUri: string, row: Record<string, unknown> | { remove: string }) {
  const script = `
    import { MongoClient } from 'mongodb'
    const row = JSON.parse(process.argv[2])
    const client = await new MongoClient(process.argv[1]).connect()
    const devices = client.db('nuphos_e2e').collection('agent_devices')
    if (row.remove) await devices.deleteOne({ deviceId: row.remove })
    else await devices.insertOne({ ...row, lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date() })
    await client.close()`

  execFileSync('bun', ['-e', script, mongoUri, JSON.stringify(row)], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
}

export async function me(stack: Stack): Promise<string> {
  const response = await fetch(`${stack.apiUrl}/auth/me`, {
    headers: { authorization: `Bearer ${stack.token}` },
  })

  return ((await response.json()) as { id: string }).id
}

/** Writes a conversation bound to a runtime: the app cannot start one on a Box that is away. */
function conversationRow(mongoUri: string, row: Record<string, unknown>) {
  const script = `
    import { MongoClient } from 'mongodb'
    const row = JSON.parse(process.argv[2])
    const client = await new MongoClient(process.argv[1]).connect()
    const conversations = client.db('nuphos_e2e').collection('agent_conversations')
    await conversations.insertOne({ ...row, createdAt: new Date(), updatedAt: new Date() })
    await client.close()`

  execFileSync('bun', ['-e', script, mongoUri, JSON.stringify(row)], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
}

export const boxScenarios: Scenario[] = [
  {
    name: 'a Box instabox paused for its host memory is logged as evicted and says why',
    run: async (page, stack) => {
      const deviceId = randomUUID()
      const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
      const label = `E2E Box ${deviceId.slice(0, 8)}`
      const credential = `nbx_e2e_${randomUUID()}`
      const userId = await me(stack)
      const machine = { id: sandboxId, state: 'running', operations: [] as never[] }

      instaboxMachines.set(sandboxId, machine)
      boxRow(stack.mongoUri, {
        userId,
        deviceId,
        label,
        platform: 'linux',
        allowLocalExec: true,
        credentialHash: createHash('sha256').update(credential).digest('base64url'),
        box: { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: userId },
        access: [{ teamId: stack.teamId, everyone: false, userIds: [], managerIds: [] }],
      })
      try {
        const from = backendLines()
        const host = new WebSocket(
          `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
          { headers: { authorization: `Bearer ${credential}` } } as unknown as string[],
        )

        await new Promise((opened, failed) => {
          host.addEventListener('open', opened)
          host.addEventListener('error', failed)
        })
        host.send(JSON.stringify({ t: 'status', status: { agentInstances: true, agents: {} } }))
        // instabox pauses the machine for its host's memory; the frozen host's tunnel goes.
        Object.assign(machine, {
          state: 'suspended',
          operations: [
            {
              type: 'suspend',
              state: 'succeeded',
              trigger: 'memory_pressure',
              createdAt: new Date().toISOString(),
            },
          ],
        })
        host.close()
        await until('the eviction to be logged', async () =>
          backendLog(from).some(
            (line) =>
              line.includes('"event":"agent.box.evicted"') &&
              line.includes('"trigger":"memory_pressure"') &&
              line.includes(`"machine_id":"${sandboxId}"`),
          ),
        )

        await page
          .getByRole('button', { name: /^Search/ })
          .first()
          .click()
        await page.keyboard.type('Computers')
        await page.getByRole('option', { name: 'Computers' }).first().click()
        await page.getByText(label).filter({ visible: true }).first().waitFor()
        await page.getByRole('status').filter({ hasText: NOTICE }).waitFor()
        // The cards fade in; the picture is taken once they have.
        await page.waitForTimeout(1_500)
        await page.screenshot({ path: join(artifacts, 'box-evicted-notice.png') })
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        boxRow(stack.mongoUri, { remove: deviceId })
        instaboxMachines.delete(sandboxId)
      }
    },
  },
  {
    // #3733: a Box whose machine instabox would not kill could never be deleted. On the
    // deployment's account the machine is Nuphos's to clean up from the log (#4094), so the
    // owner is not sent to an instabox account they do not have.
    name: "a Box the deployment's instabox will not kill is still deleted, without sending its owner to instabox",
    // The refused kill is logged, as it should be.
    expected: /"event":"agent\.box\.kill_failed"/,
    run: async (page, stack) => {
      const deviceId = randomUUID()
      const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
      const label = `E2E Box ${deviceId.slice(0, 8)}`
      const userId = await me(stack)

      instaboxMachines.set(sandboxId, { id: sandboxId, state: 'running', operations: [] })
      boxRow(stack.mongoUri, {
        userId,
        deviceId,
        label,
        platform: 'linux',
        allowLocalExec: true,
        box: { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: userId },
        access: [{ teamId: stack.teamId, everyone: false, userIds: [], managerIds: [] }],
      })
      try {
        const from = backendLines()

        await openComputers(page)
        const card = page.getByText(label, { exact: true })

        await card.first().waitFor()
        await page.getByRole('button', { name: `Manage ${label}` }).click()
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Delete computer' }).click()
        await card.first().waitFor({ state: 'detached' })
        await page.waitForTimeout(1_000)
        if (await page.getByText(KILL_REFUSED).count())
          throw new Error('A deployment-account Box sent its owner to an instabox account')
        await page.screenshot({ path: join(artifacts, 'box-delete-kill-refused.png') })
        if (!backendLog(from).some((line) => line.includes('"event":"agent.box.kill_failed"')))
          throw new Error('The refused kill was not logged')
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        boxRow(stack.mongoUri, { remove: deviceId })
        instaboxMachines.delete(sandboxId)
      }
    },
  },
  {
    name: 'a conversation on a Box that is away says the send resumes it, and does not block the send',
    // The send does start the wake, which reaches the half this stack cannot run: a Box resumed
    // here would have no public URL to dial back on. The message still queues, which is the point.
    // Removing the Box at the end fails what waits on it, as it should; that is waited for here.
    expected:
      /"event":"agent\.box\.heal_failed".*no public URL|"event":"agent\.pending_messages\.queued_launch_failed".*no longer available/,
    run: async (page, stack) => {
      const deviceId = randomUUID()
      const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
      const label = `E2E Paused Box ${deviceId.slice(0, 8)}`
      const sessionId = `e2e-paused-box-${randomUUID()}`
      const title = `Paused Box chat ${deviceId.slice(0, 8)}`
      const userId = await me(stack)
      const from = backendLines()

      // A machine instabox has parked, and no host: exactly what an idle Box looks like.
      instaboxMachines.set(sandboxId, { id: sandboxId, state: 'suspended', operations: [] })
      boxRow(stack.mongoUri, {
        userId,
        deviceId,
        label,
        platform: 'linux',
        allowLocalExec: true,
        // Its agent is remembered while the computer is away, so the conversation still has one.
        agents: [{ provider: 'claude-code', signedIn: true }],
        box: { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: userId },
        access: [{ teamId: stack.teamId, everyone: false, userIds: [], managerIds: [] }],
      })
      conversationRow(stack.mongoUri, {
        sessionId,
        teamId: stack.teamId,
        userId,
        runtimeId: `local_${userId}_${deviceId}`,
        runtimeLabel: 'Claude Code',
        title,
      })
      try {
        await page.locator('[data-sidebar-row]').filter({ hasText: title }).first().click()
        // The hint, not a red banner: the composer says the Box comes back when the message goes.
        await page
          .getByText(`${label} is paused. It resumes when you send.`)
          .first()
          .waitFor({ timeout: 30_000 })
        const sendButton = page.getByRole('button', { name: /^Send/ }).first()
        const reason = await sendButton.getAttribute('aria-label')

        if (reason !== 'Send')
          throw new Error(`the send to be free on a Box that is away, blocked with: ${reason}`)
        if (await page.getByRole('button', { name: 'Switch runtime' }).count())
          throw new Error('a Box that is away offered Switch runtime')
        await page.waitForTimeout(1_000)
        await page.screenshot({ path: join(artifacts, 'box-paused-composer.png') })

        // The promise the hint makes: the message is taken and waits for the Box, instead of
        // being refused. Waking the machine itself is instabox's, and this instabox is a stub.
        const text = `Does this reach the Box ${deviceId.slice(0, 8)}?`

        await send(page, text)
        // It waits in the conversation for the Box instead of being refused.
        await page.getByText(text).filter({ visible: true }).first().waitFor({ timeout: 30_000 })
        if (await page.getByText('Its computer is offline').count())
          throw new Error('the send to a Box that is away was refused as offline')
        // The banner takes its own room above the composer: it does not cover the queued row (#4881).
        await page.waitForTimeout(1_000)
        const takeBack = await page.getByRole('button', { name: 'Take back' }).first().boundingBox()
        const banner = await page
          .locator('[data-composer-overlay][aria-hidden="false"]')
          .first()
          .boundingBox()

        if (!takeBack || !banner || takeBack.y + takeBack.height > banner.y)
          throw new Error(
            `the paused banner ${JSON.stringify(banner)} to sit below the queued row ${JSON.stringify(takeBack)}`,
          )
        await page.screenshot({ path: join(artifacts, 'box-paused-queued.png') })
      } finally {
        // The conversation stays: Search's recent list asks for it again later, and a 404 then would
        // be charged to whichever scenario is running. Only the page leaves it.
        await newTask(page)
        boxRow(stack.mongoUri, { remove: deviceId })
        instaboxMachines.delete(sandboxId)
        // The queued message is told it cannot run now, here rather than in the next scenario.
        await until('the queued message to fail without its Box', async () =>
          backendLog(from).some(
            (line) =>
              line.includes('"event":"agent.pending_messages.queued_launch_failed"') &&
              line.includes(`"session_id":"${sessionId}"`),
          ),
        )
      }
    },
  },
]
