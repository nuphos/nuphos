import assert from 'node:assert/strict'
import { test } from 'node:test'

import { retainSessionViews } from './retainedSessionViews.ts'

const task = { teamId: 'team', sessionId: 'task', channel: false, readOnly: false }
const bot = { ...task, sessionId: 'bot-chat', channel: true }

test('Bots and Tasks retain independent views through repeated switches and kind checks', () => {
  const first = retainSessionViews({}, task)
  const second = retainSessionViews(first, bot)

  assert.equal(second.agent, first.agent, 'opening Bots must not replace the mounted Task')
  assert.deepEqual(second.channelIds, ['bot-chat'])
  assert.equal(retainSessionViews(second, task), second)
  assert.equal(retainSessionViews(second, { ...task, channel: undefined }), second)
  assert.equal(retainSessionViews(second, bot), second)
})

test('new tasks, audit locks and team changes remain isolated', () => {
  const both = retainSessionViews(retainSessionViews({}, bot), task)
  const draft = retainSessionViews(both, { ...task, sessionId: null })

  assert.equal(draft.agent?.sessionId, null)
  assert.equal(draft.channelIds, both.channelIds)
  assert.equal(retainSessionViews(both, { ...task, readOnly: true }).agent?.readOnly, true)
  assert.deepEqual(retainSessionViews(both, { ...task, teamId: 'other', channel: undefined }), {
    teamId: 'other',
  })
})

const open = (views: ReturnType<typeof retainSessionViews>, id: string) =>
  retainSessionViews(views, { ...bot, sessionId: id })

test('the last three Bot chats stay mounted, the selected one last', () => {
  const four = ['a', 'b', 'c', 'd'].reduce(open, {})

  assert.deepEqual(four.channelIds, ['b', 'c', 'd'], 'the oldest one is let go')
  assert.deepEqual(open(four, 'b').channelIds, ['c', 'd', 'b'], 'reopening one moves it last')
  assert.equal(open(four, 'd'), four, 'the selected one changes nothing')
})
