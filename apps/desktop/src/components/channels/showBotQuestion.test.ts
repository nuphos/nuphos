import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const picked: unknown[] = []

mock.module('../../views/inbox/inboxSelection.ts', {
  namedExports: {
    selectInboxQuestion: (teamId: string, selection: unknown) => picked.push([teamId, selection]),
  },
})

const { showBotQuestion } = await import('./showBotQuestion.ts')

const chatWith = (card: object | null) => ({ querySelector: () => card }) as unknown as HTMLElement

test('a question with a card in the chat is scrolled to and marked, and the Inbox stays shut', () => {
  const calls: string[] = []
  const card = {
    scrollIntoView: () => calls.push('scroll'),
    animate: () => calls.push('blink'),
  }
  const opened: string[] = []

  showBotQuestion(chatWith(card), 'team', 'q1', (href) => opened.push(href) > 0)
  assert.deepEqual(calls, ['scroll', 'blink'])
  assert.deepEqual(opened, [])
  assert.deepEqual(picked, [])
})

test('a question the chat draws no card for opens the Inbox with it selected', () => {
  const opened: string[] = []

  showBotQuestion(chatWith(null), 'team-a', 'q2', (href) => opened.push(href) > 0)
  assert.deepEqual(picked, [['team-a', 'q2']])
  assert.deepEqual(opened, ['/teams/team-a/inbox'])
})
