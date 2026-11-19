// #3963: list_agent_runtimes lists the agents on the owner's own computer, so a thread can run there.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { inDatabase } from './agent-sign-in-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const threadRuntimeScenarios: Scenario[] = [
  {
    name: "list_agent_runtimes lists the agents on the owner's own computer",
    run: async (page, stack) => {
      // A computer of the stack's person with a signed-in Claude Code, as its Desktop reports it.
      const deviceId = randomUUID()
      const auth = { authorization: `Bearer ${stack.token}` }
      const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, label: 'E2E own Mac', platform: 'darwin' }),
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
      host.send(
        JSON.stringify({
          t: 'status',
          status: { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } },
        }),
      )
      try {
        const before = agentLog(stack).length
        const args = { label: 'List the agents' }

        await newTask(page)
        await send(
          page,
          `List E2E_CALL list_agent_runtimes ${JSON.stringify(args)} E2E_DELIVERY:runtimes`,
        )
        await page.getByText('ACK E2E_DELIVERY:runtimes').waitFor()
        const answer = JSON.stringify(
          agentLog(stack)
            .slice(before)
            .find((entry) => entry.event === 'called')?.result,
        )

        writeFileSync(join(artifacts, 'list-agent-runtimes.json'), answer)
        if (!answer.includes(`_${deviceId}`))
          throw new Error(`The computer ${deviceId} is not listed: ${answer}`)
      } finally {
        host.close()
        inDatabase(
          stack.mongoUri,
          "await db.collection('agent_devices').deleteOne({ deviceId: process.argv[2] })",
          deviceId,
        )
      }
    },
  },
]
