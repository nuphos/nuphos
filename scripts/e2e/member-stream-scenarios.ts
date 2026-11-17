// What a teammate has open on the team's cloud computer, across a role change and a removal.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { joinTeam } from './dashboard-scenarios.ts'
import { until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Makes the computer one of the team's cloud computers, as only the database can here. */
function makeTeamBox(stack: Stack, deviceId: string, ownerId: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, deviceId, teamId, createdBy] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    await client.db('nuphos_e2e').collection('agent_devices')
      .updateOne({ deviceId }, { $set: { box: { provider: 'instabox', teamId, createdBy } } })
    await client.close()`

  execFileSync('bun', ['-e', script, stack.mongoUri, deviceId, stack.teamId, ownerId], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
}

/** The teammate's Task runs `command` there through local_exec, which holds a stream until it ends. */
async function runOn(stack: Stack, token: string, deviceId: string, command: string) {
  const args = JSON.stringify({ label: 'Run it', command, device: deviceId })
  const text = `Run it E2E_CALL local_exec ${args} E2E_DELIVERY:${randomUUID()}`
  const from = agentLog(stack).length

  // The reply streams until the turn ends; the tool's answer is read from the agent's log.
  void fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      teamId: stack.teamId,
      permissionMode: 'bypass',
      credentialAccess: { deviceIds: [deviceId] },
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    }),
  }).then(async (response) => response.text())

  return async () => {
    let answer = ''

    await until('local_exec to answer', async () => {
      const entry = agentLog(stack)
        .slice(from)
        .find((item) => item.event === 'called' && item.name === 'local_exec')

      answer = entry ? JSON.stringify(entry.result) : ''

      return entry
    })

    return answer
  }
}

export const memberStreamScenarios: Scenario[] = [
  {
    // #3201: a role change grants and removes nothing on a computer, so what is open there stays.
    name: "a teammate's command on the team's cloud computer outlives a role change, and removing them cuts it off",
    run: async (_page, stack) => {
      const computer = await startSecondComputer(stack, 'E2E team mini')

      try {
        const owner = client(stack.apiUrl, stack.token)
        const teammate = await joinTeam(stack, 'streams')
        const role = async (to: string) => {
          const changed = await owner('PATCH', `/teams/${stack.teamId}/members/${teammate.id}`, {
            role: to,
          })

          must(changed.status === 200, `the teammate to become ${to}, got ${String(changed.status)}`)
        }
        // Started, then still running for `seconds`: the stream stays open that long.
        const hold = async (seconds: number) => {
          const name = randomUUID().slice(0, 8)
          const started = join(computer.home, `${name}.started`)
          const answer = await runOn(
            stack,
            teammate.token,
            computer.deviceId,
            `touch ${started}; sleep ${String(seconds)}; echo ${name}-finished`,
          )

          await until('the command to start on the computer', async () => existsSync(started))

          return { finished: `${name}-finished`, answer }
        }
        const shared = await owner(
          'PUT',
          `/agent/devices/${computer.deviceId}/share?teamId=${stack.teamId}`,
          { level: 'full', everyone: false, userIds: [teammate.id], managerIds: [teammate.id] },
        )

        must(shared.status === 200, `the computer to be shared, got ${String(shared.status)}`)
        const me = (await owner('GET', '/auth/me')).body as { id?: string; user?: { id: string } }

        makeTeamBox(stack, computer.deviceId, me.user?.id ?? me.id ?? '')
        await role('ADMINISTRATOR')

        const kept = await hold(10)

        await role('EDITOR')
        await role('VIEWER')
        const afterRoles = await kept.answer()

        must(
          afterRoles.includes(kept.finished),
          `the command to finish through the role changes, got ${afterRoles}`,
        )

        await role('ADMINISTRATOR')
        const cut = await hold(30)
        const removedAt = Date.now()
        const removed = await owner('DELETE', `/teams/${stack.teamId}/members/${teammate.id}`)

        must(removed.status === 204, `the teammate to be removed, got ${String(removed.status)}`)
        const afterRemoval = await cut.answer()

        must(
          !afterRemoval.includes(cut.finished),
          `the removal to cut the command off, got ${afterRemoval}`,
        )
        must(
          Date.now() - removedAt < 20_000,
          `the command to be cut off at once, not after ${String(Date.now() - removedAt)} ms`,
        )
      } finally {
        await computer.stop()
      }
    },
  },
]
