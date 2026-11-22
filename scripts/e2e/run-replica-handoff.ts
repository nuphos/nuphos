// A turn still working when its replica is deployed away carries on, on the new replica (#4000).
// The old replica gets SIGTERM mid-turn while an app holds its change stream open, as on Nuphos
// Cloud, and the turn's work ends a few seconds after the drain force-pauses it.
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, logPath, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

const { MongoClient } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')
/** How long the work runs on after the pause, at most: a replica has adopted the turn by then. */
const WORK_AFTER_PAUSE_MS = 8_000
let failed = false

// As in the runtime image and on Desktop: text streams, so a resumed connection receives it.
process.env.OPENAB_ACP_STREAMING = 'true'

const check = (label: string, ok: boolean, detail = '') => {
  console.log([ok ? 'PASS' : 'FAIL', label, detail].filter(Boolean).join(' '))
  if (!ok) failed = true
}
const logged = (path: string, event: string) => readFileSync(path, 'utf8').includes(`"${event}"`)

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ redis: true })
  const headers = { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' }
  const mongo = await new MongoClient(stack.mongoUri).connect()
  const messages = mongo.db('nuphos_e2e').collection('agent_messages')
  const id = randomUUID()
  const marker = 'E2E_DELIVERY:replica-handoff'
  const release = join(dirname(stack.acpLog), 'release')

  rmSync(release, { force: true })
  // An open app: the stream it keeps is what the old replica's HTTP drain waits on.
  const changes = await fetch(`${stack.apiUrl}/teams/${stack.teamId}/agent-changes`, { headers })

  check('the app holds the change stream open', changes.ok)
  void changes.body?.pipeTo(new WritableStream()).catch(() => {})
  void fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id,
      teamId: stack.teamId,
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: `Work E2E_WAIT_RELEASE ${marker}` }],
        },
      ],
    }),
  })
    .then(async (response) => response.text())
    .catch(() => undefined)
  await until('the turn to start', async () =>
    agentLog(stack).some((entry) => entry.event === 'start' && entry.marker === marker),
  )

  const next = await stack.rollBackend()
  const old = logPath('backend')

  await until('the old replica to force-pause the turn', async () =>
    logged(old, 'agent.run.shutdown_force_pausing'),
  )
  const pausedAt = Date.now()

  await until(
    'the new replica to adopt the turn, or the work to end',
    async () =>
      logged(next.log, 'agent.runtime_handoff.adopted') ||
      Date.now() - pausedAt >= WORK_AFTER_PAUSE_MS,
    WORK_AFTER_PAUSE_MS + 5_000,
  )
  console.log(
    `The work ends ${String(Date.now() - pausedAt)} ms after the pause; ` +
      `adopted by then: ${String(logged(next.log, 'agent.runtime_handoff.adopted'))}`,
  )
  writeFileSync(release, '')
  await until('the agent to finish', async () =>
    agentLog(stack).some((entry) => entry.event === 'finish' && entry.marker === marker),
  )
  const answered = async () =>
    (await messages.find({ sessionId: id, role: 'assistant' }).toArray()).some((row) =>
      JSON.stringify(row).includes(`ACK ${marker}`),
    )

  await until('the reply to be saved', answered, 30_000).catch(() => {})
  check('the rest of the reply is saved after the replica exits', await answered())
  await next.exited
  check('the old replica handed the turn on', logged(old, 'agent.runtime_handoff.published'))
  await mongo.close()
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
