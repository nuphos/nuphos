import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clickOptions,
  formAnswer,
  formQuestions,
  initialStates,
  isAnswered,
  ownBody,
  pickOption,
  toggleOther,
  unanswered,
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

const state = (picked: string[], other = false, words = '') => ({ picked, other, words })

test('a form answers words when Other is picked, picks otherwise, never both', () => {
  assert.deepEqual(formAnswer([state(['us', 'eu'])]), { choices: ['us', 'eu'] })
  assert.deepEqual(formAnswer([state([], true, ' only Tokyo ')]), { text: 'only Tokyo' })
  // Words kept from an Other since unpicked do not answer.
  assert.deepEqual(formAnswer([state(['us'], false, 'old words')]), { choices: ['us'] })
  assert.deepEqual(formAnswer([state(['us']), state([], true, 'Keep it a week')]), {
    questions: [{ choices: ['us'] }, { text: 'Keep it a week' }],
  })
})

test('Other is exclusive with the options, multi-select too, and keeps its words when unpicked', () => {
  let next = initialStates([regions], true)[0]

  next = pickOption(next, 'us', true)
  next = pickOption(next, 'eu', true)
  assert.deepEqual(next, { picked: ['us', 'eu'], other: false, words: '' })
  next = { ...toggleOther(next), words: 'Tokyo' }
  assert.deepEqual(next, { picked: [], other: true, words: 'Tokyo' })
  next = pickOption(next, 'ap', true)
  assert.deepEqual(next, { picked: ['ap'], other: false, words: 'Tokyo' })
  // Picked again, its words are back; picking it again unpicks it.
  assert.deepEqual(toggleOther(next), { picked: [], other: true, words: 'Tokyo' })
  assert.deepEqual(toggleOther(toggleOther(next)), { picked: [], other: false, words: 'Tokyo' })
  // One answer: an option takes another's place.
  assert.deepEqual(pickOption(pickOption(next, 'Keep', false), 'Delete', false).picked, ['Delete'])
})

test('a question is answered by its picks, or by words once Other is picked; the rest are counted', () => {
  const reply = { question: 'Anything else?', options: [], multiSelect: false }
  const states = initialStates([regions, keep, reply], true)

  // A question with nothing to pick starts with its field when the card takes words.
  assert.deepEqual(
    states.map((s) => s.other),
    [false, false, true],
  )
  assert.deepEqual(
    initialStates([reply], false).map((s) => s.other),
    [false],
  )
  assert.equal(unanswered(states), 3)
  assert.equal(isAnswered({ picked: [], other: true, words: '  ' }), false)
  assert.equal(isAnswered({ picked: [], other: true, words: 'x' }), true)
  assert.equal(isAnswered({ picked: ['us'], other: false, words: '' }), true)
  assert.equal(
    unanswered([states[0], pickOption(states[1], 'Keep', false), { ...states[2], words: 'no' }]),
    1,
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
