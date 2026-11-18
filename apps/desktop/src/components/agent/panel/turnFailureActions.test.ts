import assert from 'node:assert/strict'
import { test } from 'node:test'

import { turnSwitchAgent } from './turnFailureActions.ts'

import type { Tab } from './model.ts'

const failed = (extra: Partial<Tab> = {}) =>
  ({
    sessionId: 's1',
    messages: [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Check the invoices' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'turn-interrupted',
            id: 'r1:interrupted',
            reason: 'error',
            message: 'Out of usage',
            createdAt: '2026-11-10T00:00:00Z',
            cause: 'usage_limit',
          },
        ],
      },
    ],
    ...extra,
  }) as unknown as Tab

test('the latest failure line offers Switch runtime', () => {
  assert.equal(turnSwitchAgent(failed(), () => undefined)?.partId, 'r1:interrupted')
})

test('Switch runtime opens only the composer beside the failure line', () => {
  let opened = 0

  turnSwitchAgent(failed(), () => opened++)?.switchAgent()
  assert.equal(opened, 1)
})

test('a viewer who cannot move the agent is not offered it', () => {
  assert.equal(
    turnSwitchAgent(failed({ foreign: true }), () => undefined),
    null,
  )
  assert.equal(
    turnSwitchAgent(failed({ readOnly: true }), () => undefined),
    null,
  )
})

test('nothing is offered once the conversation moved past the failure', () => {
  const tab = failed()

  tab.messages.push({ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Hello?' }] } as never)
  assert.equal(
    turnSwitchAgent(tab, () => undefined),
    null,
  )
})
