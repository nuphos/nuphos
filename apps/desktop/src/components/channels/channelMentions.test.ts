import assert from 'node:assert/strict'
import { test } from 'node:test'

import { linkMentions } from '../agent/panel/messageMentionText.ts'

import { channelMentions } from './channelMentions.ts'

import type { ChannelAgent } from '../../api'

const agents = [{ sessionId: 'scribe', title: '書記官' }] as ChannelAgent[]

test('a channel agent mention becomes a chip target even without human mention metadata', () => {
  assert.equal(
    linkMentions('@書記官 請幫忙', channelMentions(undefined, agents)),
    '[@書記官](#mention:agent%3Ascribe) 請幫忙',
  )
})
test('human metadata wins a same-named agent and unrelated names stay plain', () => {
  const mentions = channelMentions([{ id: 'person', displayName: '書記官' }], agents)

  assert.equal(linkMentions('@書記官 @Other', mentions), '[@書記官](#mention:person) @Other')
})
