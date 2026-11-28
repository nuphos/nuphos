import assert from 'node:assert/strict'
import test from 'node:test'

import { computerOutcome, parseComputerRequest } from './computerCardModel.ts'

const desktop = { deviceId: 'box-1', display: 2, title: 'Studio Box · :2' }
const input = {
  category: 'computer',
  question: 'Sign in to the dashboard',
  body: 'Use your own account.',
}

test('a computer card is the question and the desktop its result hands over', () => {
  const card = { question: input.question, body: input.body, desktop }

  // As an object, its JSON, or the text of an MCP result.
  assert.deepEqual(parseComputerRequest(input, { desktop, requestId: 'nuphos-1' }), card)
  assert.deepEqual(parseComputerRequest(input, JSON.stringify({ desktop })), card)
  assert.deepEqual(
    parseComputerRequest(input, [{ type: 'text', text: JSON.stringify({ desktop }) }]),
    card,
  )
  assert.deepEqual(
    parseComputerRequest(input, { content: [{ text: JSON.stringify({ desktop }) }] }),
    card,
  )
})

test('until its result names a desktop, or for another category, it is no computer card', () => {
  assert.equal(parseComputerRequest(input, undefined), null)
  assert.equal(parseComputerRequest(input, 'This conversation has no desktop to hand over'), null)
  assert.equal(parseComputerRequest(input, { desktop: { deviceId: 'box-1' } }), null)
  assert.equal(parseComputerRequest({ ...input, category: 'approval' }, { desktop }), null)
})

test('a computer card ends handed back after a takeover, done without one, or skipped', () => {
  assert.deepEqual(computerOutcome("I'm done (handed back after 3m 5s)"), {
    kind: 'handed-back',
    after: '3m 5s',
  })
  assert.deepEqual(computerOutcome("I'm done"), { kind: 'done' })
  assert.deepEqual(computerOutcome('Skip'), { kind: 'skipped' })
  assert.equal(computerOutcome(undefined), undefined)
})
