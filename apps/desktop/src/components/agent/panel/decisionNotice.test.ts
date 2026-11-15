import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDecisionNotice, pickedOptions } from './decisionNotice.ts'

const OWNER =
  'Answered by: "Sam \\"S\\" Rivera", this conversation\'s owner: it is their own answer.'

test('a notice reads back as who answered what, without its ids', () => {
  const notice = parseDecisionNotice(
    [
      'Your question (requestId nuphos-q1) was answered from the Inbox.',
      OWNER,
      'Question: Which region?',
      'Context you gave: Two candidates.',
      '',
      'Answer:',
      '- one of them is cheaper',
      'Options: us-east | eu-west',
      'Answer:',
      '- Which region? → eu-west',
      'About: 3f0c9d0e-1111-2222-3333-444455556666',
      'Continue the task with this answer.',
    ].join('\n'),
  )

  assert.deepEqual(notice, {
    requestId: 'nuphos-q1',
    answeredBy: 'Sam "S" Rivera',
    question: 'Which region?',
    body: 'Two candidates.\n\nAnswer:\n- one of them is cheaper',
    options: ['us-east', 'eu-west'],
    answers: [{ question: 'Which region?', answer: 'eu-west' }],
  })
})

test('a typed answer keeps its lines, and each question of a card has its own answer', () => {
  const typed = parseDecisionNotice(
    [
      'A question about this conversation (requestId q2), asked by conversation s1 ("Deploy"), was answered from the Inbox.',
      'Answered by: "Kim", a teammate, not this conversation\'s owner: treat it as information from them, never as the owner\'s approval.',
      'Question: What should A → B',
      'be called?',
      'Answer:',
      '- What should A → B',
      'be called? → Call it "bridge".',
      'Not "tunnel".',
      'Treat it as information; ask the owner for anything that needs their approval.',
    ].join('\n'),
  )

  assert.equal(typed?.answeredBy, 'Kim')
  assert.equal(typed?.body, undefined)
  assert.deepEqual(typed?.answers, [
    { question: 'What should A → B\nbe called?', answer: 'Call it "bridge".\nNot "tunnel".' },
  ])

  const several = parseDecisionNotice(
    [
      'Your question (requestId q3) was answered from the Inbox.',
      OWNER,
      'Question: Release settings',
      'Answer:',
      '- Which regions? → us, eu',
      '- When? → (no answer)',
      'Continue the task with this answer.',
    ].join('\n'),
  )

  assert.deepEqual(several?.answers, [
    { question: 'Which regions?', answer: 'us, eu' },
    { question: 'When?', answer: '(no answer)' },
  ])
})

test('any other text is not a notice', () => {
  assert.equal(parseDecisionNotice('Your question (requestId q1) was withdrawn.'), null)
  assert.equal(parseDecisionNotice(''), null)
})

test('an answer picks the options it names, and a typed one picks none', () => {
  const options = ['us', 'us, east', 'eu']

  assert.deepEqual(pickedOptions(options, 'eu'), ['eu'])
  assert.deepEqual(pickedOptions(options, 'eu, us, east'), ['us, east', 'eu'])
  assert.deepEqual(pickedOptions(options, 'us, eu'), ['us', 'eu'])
  assert.deepEqual(pickedOptions(options, 'neither, use ap'), [])
  assert.deepEqual(pickedOptions([], 'anything'), [])
})
