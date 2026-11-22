// The hourly file-transfer slot of an upload from this computer whose file never arrived.
// Listed in computerScenarios, after the upload that does arrive.
import { execFileSync } from 'node:child_process'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const HOUR_MS = 60 * 60 * 1000

type Stored = { count: number; status?: string; key?: string; releasedAt?: string }

/** The group as the database holds it, and the counter it was admitted on (`hourKey`'s without a group). */
function stored(stack: Stack, hourKey: string, groupId = ''): Stored {
  const script = `
    import { MongoClient, ObjectId } from 'mongodb'
    const [uri, hourKey, groupId] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const group = groupId
      ? await db.collection('file_transfer_groups').findOne({ _id: new ObjectId(groupId) })
      : null
    const key = group?.admission?.key ?? hourKey
    const counter = await db.collection('file_transfer_admissions').findOne({ _id: key })
    await client.close()
    console.log(JSON.stringify({
      count: counter?.count ?? 0,
      status: group?.status,
      key: group?.admission?.key,
      releasedAt: group?.admission?.releasedAt,
    }))`

  return JSON.parse(
    execFileSync('bun', ['-e', script, stack.mongoUri, hourKey, groupId], {
      cwd: BACKEND_DIR,
      timeout: 10_000,
    }).toString(),
  ) as Stored
}

export const transferRefundScenarios: Scenario[] = [
  {
    name: 'a failed upload gives its slot back once',
    run: async (page, stack) => {
      // The computer can see the file but not read it: the transfer is admitted,
      // then the bytes never leave the computer.
      const path = join(artifacts, 'unreadable.txt')
      const hourKey = `${stack.teamId}:${String(Math.floor(Date.now() / HOUR_MS))}`

      writeFileSync(path, 'never reaches the store')
      chmodSync(path, 0o000)
      try {
        const before = stored(stack, hourKey)

        await newTask(page)
        const args = JSON.stringify({ label: 'Upload the file', path })

        await send(page, `Bring it in E2E_CALL local_upload ${args} E2E_DELIVERY:refunded`)
        await page.getByText('ACK E2E_DELIVERY:refunded').waitFor()
        const answer = JSON.stringify(
          agentLog(stack).findLast((entry) => entry.event === 'called')?.result,
        )
        const groupId = /groupId\W+(\w+)/.exec(answer)?.[1]

        if (!groupId) throw new Error(`local_upload answered without a transfer: ${answer}`)
        let after: Stored = { count: -1 }

        await until('the failed upload to give its slot back', async () => {
          after = stored(stack, hourKey, groupId)

          return after.status === 'failed' && after.releasedAt
        })
        // Counted on the hour that admitted it, which is this one unless the hour turned.
        const expected = after.key === hourKey ? before.count : 0

        if (after.count !== expected)
          throw new Error(`The counter holds ${String(after.count)}, not ${String(expected)}`)
        // Finalizing it again, as anyone holding the id may, gives nothing more back.
        const finalized = await fetch(
          `${stack.apiUrl}/teams/${stack.teamId}/file-transfers/${groupId}/finalize`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
            body: '{}',
          },
        )

        if (!finalized.ok) throw new Error(`finalize answered ${String(finalized.status)}`)
        await page.waitForTimeout(2_000)
        const again = stored(stack, hourKey, groupId)

        if (again.count !== expected || again.status !== 'failed')
          throw new Error(`A second finalize changed the slot: ${JSON.stringify(again)}`)
      } finally {
        rmSync(path, { force: true })
      }
    },
  },
]
