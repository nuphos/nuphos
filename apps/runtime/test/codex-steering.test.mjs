import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nuphosSteerCodex } from '../image/codex-acp/steering.mjs'

test('steering targets the existing native turn and preserves its identity', async () => {
  const session = { currentTurnId: 'native-turn' }
  const requests = []
  const agent = {
    getSessionState: () => session,
    codexAcpClient: {
      codexClient: {
        sendRequest: async (request) => {
          requests.push(request)

          return { turnId: 'native-turn' }
        },
      },
    },
  }

  assert.deepEqual(
    await nuphosSteerCodex(agent, {
      sessionId: 'thread',
      prompt: [{ type: 'text', text: 'Focus on tests' }],
    }),
    { outcome: 'injected' },
  )
  assert.deepEqual(requests, [
    {
      method: 'turn/steer',
      params: {
        threadId: 'thread',
        expectedTurnId: 'native-turn',
        input: [{ type: 'text', text: 'Focus on tests', text_elements: [] }],
      },
    },
  ])
  assert.equal(session.currentTurnId, 'native-turn')
})

test('idle and raced native turns never fall back to a new prompt', async () => {
  const agent = { getSessionState: () => ({ currentTurnId: null }) }
  const params = { sessionId: 'thread', prompt: [{ type: 'text', text: 'Follow up' }] }

  assert.equal((await nuphosSteerCodex(agent, params)).outcome, 'promptRequired')
  agent.getSessionState = () => ({ currentTurnId: 'old' })
  agent.codexAcpClient = {
    codexClient: {
      sendRequest: async () => {
        throw new Error('active turn changed')
      },
    },
  }
  await assert.rejects(nuphosSteerCodex(agent, params), /active turn changed/)
})

test('invalid inputs and invalid acknowledgements are not reported as delivered', async () => {
  await assert.rejects(nuphosSteerCodex({}, { sessionId: 'thread', prompt: [] }), /non-empty text/)
  await assert.rejects(
    nuphosSteerCodex(
      {
        getSessionState: () => ({ currentTurnId: 'one' }),
        codexAcpClient: { codexClient: { sendRequest: async () => ({ turnId: 'two' }) } },
      },
      { sessionId: 'thread', prompt: [{ type: 'text', text: 'hi' }] },
    ),
    /acknowledgement/,
  )
})
