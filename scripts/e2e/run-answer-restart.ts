// An answer whose turn its runtime's restart cut off stays answered: the agent already
// received it, so the person is not asked the same question again (#5109). Real backend,
// MongoDB and OpenAB; the fixture agent stands in for a model.
import { rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

const { MongoClient } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')

type Request = { id: string; status: string; body?: string }
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const as = client(stack.apiUrl, stack.token)
  const mongo = await new MongoClient(stack.mongoUri).connect()
  const conversations = mongo.db('nuphos_e2e').collection('agent_conversations')
  const release = join(artifacts, 'release')
  const calls = (name: string) =>
    agentLog(stack).filter((entry) => entry.event === 'called' && entry.name === name)
  // The answer's turn completes a tool call, then holds until released.
  const ask = {
    label: 'Ask',
    category: 'approval',
    question: 'Publish the E2E draft?',
    body: 'E2E_CALL list_user_decisions {"label":"List"} E2E_WAIT_RELEASE E2E_DELIVERY:answered',
    options: ['Publish', 'Wait'],
  }
  const id = crypto.randomUUID()

  writeFileSync(release, '')
  const started = await as('POST', '/agent/chat', {
    id,
    teamId: stack.teamId,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `Ask E2E_CALL request_user_decision ${JSON.stringify(ask)} E2E_DELIVERY:ask`,
          },
        ],
      },
    ],
  })

  must(started.status === 200, `the chat to start, got ${String(started.status)}`)
  const requests = async () =>
    ((await conversations.findOne({ sessionId: id }))?.inputRequests ?? []) as Request[]
  let requestId = ''

  await until('the question to be open', async () => {
    requestId = (await requests()).find((request) => request.status === 'open')?.id ?? ''

    return Boolean(requestId)
  })
  await until('the asking turn to finish', async () =>
    agentLog(stack).some(
      (entry) => entry.event === 'finish' && entry.marker === 'E2E_DELIVERY:ask',
    ),
  )
  rmSync(release, { force: true })
  const listed = calls('list_user_decisions').length
  const answered = await as(
    'POST',
    `/agent/conversations/${id}/decisions/${requestId}/answer?teamId=${stack.teamId}`,
    { choices: ['Publish'] },
  )

  must(answered.status === 200, `the answer to be taken, got ${answered.text}`)
  // The agent has the answer and has acted on it; then its runtime restarts under the turn.
  await until(
    'the agent to act on the answer',
    async () => calls('list_user_decisions').length > listed,
  )
  await stack.restartAgentHost()
  writeFileSync(release, '')
  // Room for the backend to see the lost turn and report it.
  await Bun.sleep(20_000)
  const after = await requests()
  const conversation = await conversations.findOne({ sessionId: id })

  writeFileSync(
    join(artifacts, 'answer-restart-state.json'),
    JSON.stringify({ inputRequests: after, waitingAnswers: conversation?.waitingAnswers }, null, 2),
  )
  console.log(`inputRequests after the restart: ${JSON.stringify(after)}`)
  const reopened = after.some((request) => request.id === requestId && request.status === 'open')

  console.log(`${reopened ? 'FAIL' : 'PASS'} the answered question stays answered`)
  if (reopened) failed = true
  await mongo.close()
} catch (error) {
  console.error(error)
  failed = true
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
