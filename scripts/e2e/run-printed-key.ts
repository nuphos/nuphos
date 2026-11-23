// A key an agent's tool prints is redacted in the live stream and in the stored transcript
// (#4750), on a real backend and OpenAB runtime. The key and session token are fictional.
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { client, must } from './binding-access-scenarios.ts'
import { PRINTED_SECRET, PRINTED_SESSION } from './fixture-commands.mjs'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

const { MongoClient } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')
let failed = false

const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failed = true
}
const leaks = (text: string) => [PRINTED_SECRET, PRINTED_SESSION].some((key) => text.includes(key))

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const as = client(stack.apiUrl, stack.token)
  const mongo = await new MongoClient(stack.mongoUri).connect()
  const messages = mongo.db('nuphos_e2e').collection('agent_messages')
  const id = randomUUID()
  const stored = async () => JSON.stringify(await messages.find({ sessionId: id }).toArray())

  const live = await as('POST', '/agent/chat', {
    id,
    teamId: stack.teamId,
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: 'Show the file E2E_PRINTED_KEY E2E_DELIVERY:printed-key' }],
      },
    ],
  })

  must(live.status === 200, `chat to start, got ${live.status}`)
  await until('the turn to be stored', async () =>
    (await stored()).includes('ACK E2E_DELIVERY:printed-key'),
  )
  const transcript = await stored()

  check('the live stream carried the tool call', live.text.includes('cat ~/.aws/credentials'))
  check('the live stream shows the keys redacted', live.text.includes('[REDACTED:aws-secret]'))
  check('the live stream never carries the keys', !leaks(live.text))
  check('the stored transcript holds the tool call', transcript.includes('cat ~/.aws/credentials'))
  check('the stored transcript never carries the keys', !leaks(transcript))
  await mongo.close()
} catch (error) {
  console.error(error)
  failed = true
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
