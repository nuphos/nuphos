import assert from 'node:assert/strict'
import { test } from 'node:test'

import { freshMentions } from './mentionNotice.ts'

import type { ChannelMention } from '../../api/agent-types'

const mention = (messageId: string): ChannelMention => ({
  channelId: 'c',
  title: 'Plan',
  messageId,
  at: '2026-11-04T00:00:00.000Z',
  sender: { type: 'user', id: 'u', name: 'Matthew' },
  text: '@Daniel Hi',
})

test('what the first load finds was already there, so nothing is announced', () => {
  assert.deepEqual(freshMentions(null, [mention('m1')]), [])
})

test('a mention that was not there before is announced, once', () => {
  assert.deepEqual(freshMentions(new Set(['m1']), [mention('m1'), mention('m2')]), [mention('m2')])
  assert.deepEqual(freshMentions(new Set(['m1', 'm2']), [mention('m2')]), [])
})
