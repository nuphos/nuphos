// Scenarios about a cloud computer (a Box) that instabox itself paused.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

import { backendLines, backendLog } from './backend-log.ts'
import { instaboxMachines } from './instabox-stub.ts'
import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const NOTICE = 'Paused by the provider (host out of memory). It resumes when you use it.'
const KILL_REFUSED =
  "Its machine on instabox couldn't be stopped and may still be running. Check your team's instabox account."

/** Writes or removes a Box row as the backend keeps it: only the database can make one here. */
function boxRow(mongoUri: string, row: Record<string, unknown> | { remove: string }) {
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

async function me(stack: Stack): Promise<string> {
  const response = await fetch(`${stack.apiUrl}/auth/me`, {
    headers: { authorization: `Bearer ${stack.token}` },
  })

  return ((await response.json()) as { id: string }).id
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
        await page.getByText(label).first().waitFor()
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
    // #3733: a Box whose machine instabox would not kill could never be deleted.
    name: 'a Box instabox will not kill is still deleted, and its owner hears it may still run',
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
        await page.getByText(KILL_REFUSED).waitFor()
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
]
