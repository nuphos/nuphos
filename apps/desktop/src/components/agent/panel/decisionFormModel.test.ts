import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decisionAnswers } from './decisionAnswers.ts'
import {
  answerText,
  answersForm,
  formQuestions,
  formReply,
  ownBody,
  writtenQuestions,
} from './decisionFormModel.ts'

import type { Message } from './model.ts'

const regions = { question: 'Which regions?', options: ['us', 'eu', 'ap'], multiSelect: true }
const keep = { question: 'Keep the old cluster?', options: ['Keep', 'Delete'], multiSelect: false }

test('one single-choice question keeps its buttons; a multi-select or several questions are a form', () => {
  assert.equal(formQuestions({ question: 'Ship?', options: ['Yes', 'No'] }), null)
  assert.deepEqual(
    formQuestions({ question: 'Which regions?', options: ['us', 'eu', 'ap'], multiSelect: true }),
    [regions],
  )
  assert.deepEqual(
    formQuestions({ question: 'Rollout', options: [], questions: [regions, keep] }),
    [regions, keep],
  )
})

test('the reply is a lone answer as is, or each question followed by its answer', () => {
  assert.equal(answerText(['us', 'eu'], ''), 'us, eu')
  assert.equal(answerText(['us'], '  only Tokyo '), 'only Tokyo')
  assert.equal(formReply([regions], ['us, eu']), 'us, eu')
  assert.equal(
    formReply([regions, keep], ['us, eu', 'Keep']),
    'Which regions?\nus, eu\n\nKeep the old cluster?\nKeep',
  )
  assert.equal(answersForm([regions], 'us, eu'), true)
  assert.equal(answersForm([regions], 'somewhere else'), false)
  assert.equal(
    answersForm([regions, keep], 'Which regions?\nus\n\nKeep the old cluster?\nKeep'),
    true,
  )
})

test('a card with questions drops only the list the backend wrote out, never a `---` of its own', () => {
  const written = `Context.${writtenQuestions([regions, keep])}`

  assert.equal(
    written,
    'Context.\n\n---\n\n**1. Which regions?** (any number)\n- us\n- eu\n- ap\n\n**2. Keep the old cluster?**\n- Keep\n- Delete',
  )
  assert.equal(ownBody(written, [regions, keep]), 'Context.')
  assert.equal(ownBody(writtenQuestions([regions, keep]), [regions, keep]), undefined)
  assert.equal(ownBody(written, undefined), written)
  // The raw call input has no list: the agent's own separators and what follows them stay.
  const own = 'Findings.\n\n---\n\nRisks.'

  assert.equal(ownBody(own, [regions, keep]), own)
  assert.equal(ownBody(`${own}${writtenQuestions([regions, keep])}`, [regions, keep]), own)
})

test("a form's reply marks its card answered in the transcript", () => {
  const messages = [
    {
      id: 'a',
      role: 'assistant',
      parts: [
        {
          type: 'tool',
          toolName: 'request_user_decision',
          toolCallId: 'q1',
          input: { question: 'Rollout', questions: [regions, keep] },
          state: 'output-available',
        },
      ],
    },
    {
      id: 'u',
      role: 'user',
      parts: [{ type: 'text', text: 'Which regions?\nus\n\nKeep the old cluster?\nDelete' }],
    },
  ] as unknown as Message[]

  assert.equal(decisionAnswers(messages).get('q1')?.option.endsWith('Delete'), true)
})
