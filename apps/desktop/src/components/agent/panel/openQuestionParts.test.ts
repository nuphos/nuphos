import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseSecretRequest } from './connectCardModel.ts'
import { openQuestionParts, withoutQuestionRows } from './openQuestionParts.ts'
import { INTERRUPTED_TOOL_MESSAGE } from './toolInterruption.ts'
import { isDecisionCardPart, isPlainToolPart } from './toolRuns.ts'

import type { Message } from './model.ts'
import type { Part } from './parts.ts'
import type { ReplyQuestion } from './replyTarget.ts'

/** A turn that called request_user_decision, as the runtime stored it. */
function stored(toolCallId: string, input?: Record<string, unknown>): Message {
  const part: Part = {
    type: 'tool',
    toolName: 'request_user_decision',
    toolCallId,
    ...(input ? { input } : {}),
    state: 'input-available',
  }

  return { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Over to you.' }, part] }
}

const shipIt: ReplyQuestion = { id: 'q1', question: 'Ship it?', options: ['Ship', 'Wait'] }

/** A question the turn ended before answering, as the transcript kept it: a row. */
function interrupted(toolCallId: string, errorText = INTERRUPTED_TOOL_MESSAGE): Message {
  const part: Part = {
    type: 'tool',
    toolName: 'request_user_decision',
    toolCallId,
    state: 'output-error',
    errorText,
  }

  return { id: 'm2', role: 'assistant', parts: [part] }
}

test('an open question the transcript kept no card for is drawn as its own card', () => {
  // The stored call kept no readable input, so the transcript can only show it
  // as a tool row. What the record still has open is drawn as a card instead —
  // and as an open question, never as an interrupted one.
  const parts = openQuestionParts([stored('q1')], [shipIt])

  assert.equal(parts.length, 1)
  const [part] = parts

  assert.equal(part.toolCallId, 'q1')
  assert.equal(part.state, 'input-available')
  assert.equal(isDecisionCardPart(part), true)
  assert.deepEqual(part.input, { question: 'Ship it?', options: ['Ship', 'Wait'] })
})

test('a secret the record kept is drawn as its own secure card', () => {
  const [part] = openQuestionParts(
    [],
    [{ id: 'q9', question: 'Paste the token', secret: true, secretName: 'DEPLOY_TOKEN' }],
  )

  assert.equal(isDecisionCardPart(part), true)
  assert.deepEqual(parseSecretRequest(part.input), {
    name: 'DEPLOY_TOKEN',
    reason: 'Paste the token',
  })
})

test('a question the transcript already draws is never drawn again', () => {
  const drawn = { question: 'Ship it?', options: ['Ship', 'Wait'] }

  // The stored step keeps the request's own id …
  assert.deepEqual(openQuestionParts([stored('q1', drawn)], [shipIt]), [])
  // … and a native runtime's transcript keeps the id its own call has.
  assert.deepEqual(openQuestionParts([stored('exec-1', drawn)], [shipIt]), [])
})

test('only the open questions its transcript cannot draw are added', () => {
  const which: ReplyQuestion = { id: 'q2', question: 'Which branch?', options: ['main'] }
  const drawn = stored('q1', { question: 'Ship it?', options: ['Ship', 'Wait'] })

  assert.deepEqual(
    openQuestionParts([drawn], [shipIt, which]).map((part) => part.toolCallId),
    ['q2'],
  )
  // An answered or failed question is open no more: its stored step stands as
  // the transcript drew it, with nothing added under it.
  assert.deepEqual(openQuestionParts([drawn], []), [])
  // So does a call the turn cut short before it was answered, once the record
  // no longer holds it open: its interrupted row is left as it is.
  assert.deepEqual(openQuestionParts([interrupted('q3')], []), [])
})

test('an interrupted question row is hidden while its card is shown', () => {
  const message = interrupted('q1')

  // The record still holds the question, so the card says it ...
  assert.equal(openQuestionParts([message], [shipIt]).length, 1)
  // ... and the interrupted row beside it is no longer drawn as a tool row.
  assert.equal(withoutQuestionRows(message.parts, [shipIt]).some(isPlainToolPart), false)
})

test('an interrupted row with no open question stays', () => {
  const [noRecord] = withoutQuestionRows(interrupted('q1').parts, [])

  assert.equal(isPlainToolPart(noRecord), true)
  // An open question it does not ask does not hide it either.
  const [other] = withoutQuestionRows(interrupted('q1').parts, [
    { id: 'q2', question: 'Which branch?', options: ['main'] },
  ])

  assert.equal(isPlainToolPart(other), true)
})

test('a genuinely failed call keeps its row', () => {
  const failed = interrupted('q1', 'Invalid input')
  const [part] = withoutQuestionRows(failed.parts, [shipIt])

  assert.equal(part, failed.parts[0])
  assert.equal(isPlainToolPart(part), true)
})
