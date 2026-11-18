// #3536: a Box runs the `nuphos agent` host, which has no terminal. The agent is not offered one
// there, and naming it says so instead of reporting the computer as disconnected.
import { randomUUID } from 'node:crypto'

import { agentLog } from './agent-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

/** One turn whose agent calls `name` with `args` on a conversation that selected `deviceId`. */
async function callOn(stack: Stack, deviceId: string, name: string, args: object) {
  const text = `Call it E2E_CALL ${name} ${JSON.stringify({ label: 'Call it', ...args })} E2E_DELIVERY:${randomUUID()}`
  const from = agentLog(stack).length
  let answer = ''

  void fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      teamId: stack.teamId,
      permissionMode: 'bypass',
      credentialAccess: { deviceIds: [deviceId] },
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    }),
  })
    .then(async (response) => response.text())
    .catch(() => undefined)
  await until(`${name} to answer`, async () => {
    const entry = agentLog(stack)
      .slice(from)
      .find((item) => item.event === 'called' && item.name === name)

    answer = entry ? JSON.stringify(entry.result) : ''

    return entry
  })

  return answer
}

function must(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
}

export const terminalScenarios: Scenario[] = [
  {
    name: 'a computer running `nuphos agent` is not offered a terminal, and naming it says why',
    run: async (_page, stack) => {
      const computer = await startSecondComputer(stack, 'E2E terminal-less box')
      const { deviceId } = computer

      try {
        const ran = await callOn(stack, deviceId, 'local_exec', { command: 'echo exec-ok' })

        must(ran.includes('exec-ok'), `local_exec to run there, got ${ran}`)
        const offered = await callOn(stack, deviceId, 'local_terminal', { action: 'open' })

        must(
          offered.includes('No selected device can open a terminal'),
          `no terminal to be offered, got ${offered}`,
        )
        const named = await callOn(stack, deviceId, 'local_terminal', {
          action: 'open',
          device: deviceId,
        })

        must(
          named.includes(`Device ${deviceId} cannot open a terminal`) &&
            !named.includes('disconnected'),
          `naming it to say it has no terminal, got ${named}`,
        )
      } finally {
        await computer.stop()
        forgetComputer(stack.mongoUri, deviceId)
      }
    },
  },
]
