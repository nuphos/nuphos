import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  answerText,
  formAnswer,
  formQuestions,
  ownBody,
  writtenQuestions,
} from './decisionFormModel.ts'

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

test('a form answers its picks, or what was typed in their place, per question', () => {
  assert.equal(answerText(['us', 'eu'], ''), 'us, eu')
  assert.equal(answerText(['us'], '  only Tokyo '), 'only Tokyo')
  assert.deepEqual(formAnswer([regions], [['us', 'eu']], ['']), { choices: ['us', 'eu'] })
  assert.deepEqual(formAnswer([regions], [['us']], [' only Tokyo ']), { text: 'only Tokyo' })
  assert.deepEqual(formAnswer([regions, keep], [['us'], []], ['', 'Keep it a week']), {
    questions: [{ choices: ['us'] }, { text: 'Keep it a week' }],
  })
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
