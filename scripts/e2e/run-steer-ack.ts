// A post steered into a busy Bot's turn reaches it once, even when the agent acknowledges the
// steer only after OpenAB stopped waiting for it ("delivery is unknown"). On a real backend,
// Redis and OpenAB runtime, as steering needs the run registry Redis holds.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

const MARKER = 'E2E_DELIVERY:slow-steer-post'
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  mkdirSync(artifacts, { recursive: true })
  // The fixture agent then says it takes steers, and acknowledges each one late.
  writeFileSync(join(artifacts, 'slow-steer'), '')
  const stack = await startStack({ redis: true })
  const as = client(stack.apiUrl, stack.token)
  const id = randomUUID()
  // Held until cancelled; its stream is left open, as a Desktop watching it would.
  void fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      teamId: stack.teamId,
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'Keep working E2E_HOLD E2E_DELIVERY:slow-steer-turn' }],
        },
      ],
    }),
  }).catch(() => undefined)
  await until('the held turn to start', async () =>
    agentLog(stack).some(
      (entry) => entry.event === 'start' && entry.marker === 'E2E_DELIVERY:slow-steer-turn',
    ),
  )
  const acpSession = agentLog(stack).find(
    (entry) => entry.event === 'start' && entry.marker === 'E2E_DELIVERY:slow-steer-turn',
  )!.sessionId
  const ok = async (method: string, path: string, body?: object) => {
    const reply = await as(method, `${path}?teamId=${stack.teamId}`, {
      teamId: stack.teamId,
      ...body,
    })

    must(reply.status < 300, `${method} ${path} to succeed, got ${String(reply.status)}`)

    return reply.body as { sessionId?: string }
  }

  await ok('POST', `/agent/conversations/${id}/bot`)
  const chat = (await ok('POST', '/agent/channels', { title: 'E2E slow steer chat', group: true }))
    .sessionId

  must(Boolean(chat), 'the group chat to be created')
  await ok('POST', `/agent/conversations/${chat!}/agents`, { sessionId: id })
  await ok('POST', `/agent/conversations/${chat!}/channel-messages`, {
    text: `Can you look at this? ${MARKER}`,
  })
  const deliveries = () =>
    agentLog(stack).filter(
      (entry) =>
        entry.markers?.includes(MARKER) && (entry.event === 'steered' || entry.event === 'start'),
    )

  await until('the post to reach the Bot', async () => deliveries().length > 0)
  // Long enough for a steer taken as failed to be retried several times.
  await Bun.sleep(30_000)
  await ok('POST', `/agent/conversations/${id}/cancel-runtime`)
  await until('the held turn to stop', async () =>
    agentLog(stack).some((entry) => entry.event === 'cancelled' && entry.sessionId === acpSession),
  )
  // A notice still queued would start a turn of its own once the held one ends.
  await Bun.sleep(15_000)
  const got = deliveries()

  console.log(`Deliveries: ${got.map((entry) => `${entry.event} ${entry.sessionId}`).join(', ')}`)
  console.log(`${got.length === 1 ? 'PASS' : 'FAIL'} one post reached the busy Bot once`)
  if (got.length !== 1) failed = true
} catch (error) {
  console.error(error)
  failed = true
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
