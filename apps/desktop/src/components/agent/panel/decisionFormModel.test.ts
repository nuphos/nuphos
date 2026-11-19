import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clickOptions,
  formAnswer,
  formQuestions,
  ownBody,
  writtenQuestions,
} from './decisionFormModel.ts'

const regions = { question: 'Which regions?', options: ['us', 'eu', 'ap'], multiSelect: true }
const keep = { question: 'Keep the old cluster?', options: ['Keep', 'Delete'], multiSelect: false }

test('a card answers its own questions, or the one it asks, single- or multi-select alike', () => {
  assert.deepEqual(formQuestions({ question: 'Ship?', options: ['Yes', 'No'] }), [
    { question: 'Ship?', options: ['Yes', 'No'], multiSelect: false },
  ])
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

test('only one question with one answer is answered by a click, read from the question itself', () => {
  assert.deepEqual(
    clickOptions([{ question: 'Ship?', options: ['Yes', 'No'], multiSelect: false }]),
    ['Yes', 'No'],
  )
  // A one-entry `questions` card with its own multiSelect, the top level saying nothing of it.
  const card = { question: 'q', options: ['a', 'b'], questions: [{ ...regions }] }

  assert.equal(clickOptions(formQuestions(card)), undefined)
  assert.equal(clickOptions([regions, keep]), undefined)
})
