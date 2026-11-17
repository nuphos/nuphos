// Scenarios about the computer the app runs on: its registration, its tunnel and its files.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { backendLines, backendLog } from './backend-log.ts'
import { artifacts, until } from './processes.ts'
import { transferRefundScenarios } from './transfer-refund-scenarios.ts'
import { newTask, openComputers, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const OPENED = /"agent\.local_runtime\.tunnel_opened".*"device_id":"([^"]+)"/

function forgetComputer(mongoUri: string, deviceId: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    await client.db('nuphos_e2e').collection('agent_devices').deleteOne({ deviceId: process.argv[2] })
    await client.close()`

  execFileSync('bun', ['-e', script, mongoUri, deviceId], { cwd: BACKEND_DIR, timeout: 10_000 })
}

/** One authenticated call to the backend under test. */
async function api<T>(stack: Stack, path: string, body?: unknown): Promise<T> {
  const response = await fetch(stack.apiUrl + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as T
}

/** The answer of the last `name` call the fixture made for E2E_CALL. */
export async function calledTool(stack: Stack, name: string): Promise<string> {
  let answer = ''

  await until(`the agent to call ${name}`, async () => {
    const entry = agentLog(stack).findLast((item) => item.event === 'called' && item.name === name)

    answer = entry ? JSON.stringify(entry.result) : ''

    return entry
  })

  return answer
}

/** Puts `content` in the transfer store as an agent's transfer-push.sh does, and returns its group. */
async function pushed(stack: Stack, fileName: string, content: string): Promise<string> {
  const transfers = `/teams/${stack.teamId}/file-transfers`
  const { groupId, files } = await api<{ groupId: string; files: { uploadUrl: string }[] }>(
    stack,
    transfers,
    { direction: 'download', files: [{ fileName, size: Buffer.byteLength(content) }] },
  )

  await fetch(files[0]?.uploadUrl ?? '', { method: 'PUT', body: content })
  await api(stack, `${transfers}/${groupId}/finalize`, {})

  return groupId
}

export const computerScenarios: Scenario[] = [
  {
    // #3172: removed while its tunnel was down, a running app dialed into 404s until it was restarted.
    name: 'a computer removed while its tunnel is down registers itself again and comes back',
    run: async (_page, stack) => {
      let deviceId: string | undefined

      await until('the app to open its tunnel', async () => {
        deviceId = backendLog()
          .map((line) => OPENED.exec(line)?.[1])
          .findLast(Boolean)

        return deviceId
      })
      const tunnel = `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId!}/runtime-tunnel`
      // Another connection takes the computer, so the app's own tunnel is down and asking back.
      const other = new WebSocket(tunnel, {
        headers: { authorization: `Bearer ${stack.token}` },
      } as unknown as string[])

      await new Promise((opened, failed) => {
        other.addEventListener('open', opened)
        other.addEventListener('error', failed)
      })
      const from = backendLines()

      forgetComputer(stack.mongoUri, deviceId!)
      other.close()
      await until(
        'the app to be refused as unregistered, then to open its tunnel again',
        async () => {
          const lines = backendLog(from)
          const refused = lines.findIndex(
            (line) => line.includes('/runtime-tunnel"') && line.includes('"device_not_found"'),
          )

          return (
            refused >= 0 && lines.slice(refused).some((line) => OPENED.exec(line)?.[1] === deviceId)
          )
        },
      )
    },
  },
  {
    // The agent reads a file off this computer through its own tunnel into the transfer store.
    name: 'an agent uploads a file from the computer the app runs on',
    run: async (page, stack) => {
      const content = `from this computer ${randomUUID()}`
      const path = join(artifacts, 'from-this-computer.txt')

      writeFileSync(path, content)
      await newTask(page)
      const args = JSON.stringify({ label: 'Upload the file', path })

      await send(page, `Bring it in E2E_CALL local_upload ${args} E2E_DELIVERY:uploaded`)
      await page.getByText('ACK E2E_DELIVERY:uploaded').waitFor()
      const answer = await calledTool(stack, 'local_upload')
      const groupId = /groupId\W+(\w+)/.exec(answer)?.[1]

      if (!groupId) throw new Error(`local_upload answered without a transfer: ${answer}`)
      const transfers = `/teams/${stack.teamId}/file-transfers/${groupId}`

      await until('the upload to arrive', async () => {
        const { status } = await api<{ status: string }>(stack, transfers)

        if (status === 'failed') throw new Error('The upload failed')

        return status === 'ready'
      })
      const { files } = await api<{ files: { downloadUrl?: string }[] }>(
        stack,
        `${transfers}/download`,
      )
      const stored = await (await fetch(files[0]?.downloadUrl ?? '')).text()

      if (stored !== content) throw new Error(`The store holds ${JSON.stringify(stored)}`)
    },
  },
  {
    // #3186: the agent saves a file onto the computer the app runs on; that computer fetches it.
    name: 'an agent saves a file onto the computer the app runs on, and asks before replacing it',
    run: async (page, stack) => {
      const path = join(artifacts, 'saved-by-the-agent.html')
      const first = `<p>${randomUUID()}</p>`
      const second = `<p>${randomUUID()}</p>`
      const save = async (marker: string, content: string, overwrite?: boolean) => {
        const groupId = await pushed(stack, 'deck.html', content)
        const args = JSON.stringify({ label: 'Save the file', groupId, path, overwrite })
        const before = agentLog(stack).length

        await send(page, `Save it E2E_CALL local_download ${args} E2E_DELIVERY:${marker}`)
        await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()

        return JSON.stringify(
          agentLog(stack)
            .slice(before)
            .find((entry) => entry.event === 'called')?.result,
        )
      }

      await newTask(page)
      const saved = await save('saved', first)

      if (!existsSync(path) || readFileSync(path, 'utf8') !== first)
        throw new Error(`local_download did not write the file: ${saved}`)
      if (saved.includes('signed')) throw new Error(`A signed URL reached the agent: ${saved}`)
      const refused = await save('kept', second)

      if (!refused.includes('file_exists') || readFileSync(path, 'utf8') !== first)
        throw new Error(`An existing file was not kept: ${refused}`)
      await save('replaced', second, true)
      if (readFileSync(path, 'utf8') !== second) throw new Error('overwrite did not replace it')
    },
  },
  {
    // An updated host whose agents have not started yet lists none; it still takes a new one.
    name: 'a connected computer that lists no agents yet offers to add one',
    run: async (page, stack) => {
      const deviceId = randomUUID()
      const label = `E2E idle computer ${deviceId.slice(0, 8)}`
      const auth = { authorization: `Bearer ${stack.token}` }
      const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, label, platform: 'darwin', allowLocalExec: true }),
      })

      if (!registered.ok) throw new Error(`Registering answered ${String(registered.status)}`)
      const host = new WebSocket(
        `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
        { headers: auth } as unknown as string[],
      )

      host.addEventListener('message', (event) => {
        if (String(event.data).includes('"ping"')) host.send(JSON.stringify({ t: 'pong' }))
      })
      await new Promise((opened, failed) => {
        host.addEventListener('open', opened)
        host.addEventListener('error', failed)
      })
      host.send(JSON.stringify({ t: 'status', status: { agentInstances: true, agents: {} } }))
      try {
        await openComputers(page)
        await page.getByRole('button', { name: `New runtime on ${label}` }).click()
        await page.getByRole('menu').waitFor()
        // The menu fades in.
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'add-runtime-no-agents.png') })
        const codex = page.getByRole('menuitem', { name: 'Codex', exact: true })

        if (!(await codex.count()) || (await codex.isDisabled()))
          throw new Error('Adding Codex is not offered')
        if (await page.getByText('Update the computer host').count())
          throw new Error('The menu blames the computer host')
        await page.keyboard.press('Escape')
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        host.close()
        forgetComputer(stack.mongoUri, deviceId)
      }
    },
  },
  ...transferRefundScenarios,
]
