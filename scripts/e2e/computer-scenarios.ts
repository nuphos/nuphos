// Scenarios about the computer the app under test runs on, which holds its own device tunnel.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

/** One authenticated call to the backend under test. */
async function api<T>(stack: Stack, path: string): Promise<T> {
  const response = await fetch(stack.apiUrl + path, {
    headers: { authorization: `Bearer ${stack.token}` },
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

export const computerScenarios: Scenario[] = [
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
]
