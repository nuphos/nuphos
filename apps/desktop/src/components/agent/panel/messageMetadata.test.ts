import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseMessageMetadata, senderLabel } from './messageMetadata.ts'
import { parseSteeringPart } from './steering.ts'

for (const [source, type, displayName] of [
  ['agent.thread', 'agent', 'Nuphos agent'],
  ['agent.resource', 'system', 'GitHub'],
  ['nuphos', 'user', 'Yuanlin'],
]) {
  test(`${source} keeps its sender label in transcript and steering metadata`, () => {
    const metadata = {
      version: 1,
      sender: { type, id: 'sender', displayName },
      source,
      sentAt: '2026-10-11T00:00:00Z',
    }

    assert.equal(parseMessageMetadata(metadata)?.sender.displayName, displayName)
    assert.equal(parseMessageMetadata(metadata)?.sender.type, type)
    assert.equal(
      parseSteeringPart({
        type: 'data-steering',
        data: { id: 'message', text: 'CI passed', metadata },
      })?.data.metadata?.sender.displayName,
      displayName,
    )
    assert.equal(
      parseMessageMetadata({ ...metadata, sender: { ...metadata.sender, type: 'unexpected' } }),
      undefined,
    )
  })
}

test('agent.thread keeps the session it came from', () => {
  const metadata = {
    version: 1,
    sender: { type: 'agent', id: 'source', displayName: 'Review PRs' },
    source: 'agent.thread',
    sourceSessionId: 'source',
    sentAt: '2026-10-11T00:00:00Z',
  }

  assert.equal(parseMessageMetadata(metadata)?.sourceSessionId, 'source')
})

test('agent.thread keeps known runtime icons and drops unknown providers', () => {
  const metadata = {
    version: 1,
    sender: { type: 'agent', id: 'source', displayName: 'Review', agentRuntime: 'codex' },
    source: 'agent.thread',
    sourceSessionId: 'source',
    sentAt: '2026-10-11T00:00:00Z',
  }

  assert.equal(parseMessageMetadata(metadata)?.sender.agentRuntime, 'codex')
  assert.equal(
    parseMessageMetadata({ ...metadata, sender: { ...metadata.sender, agentRuntime: 'unknown' } })
      ?.sender.agentRuntime,
    undefined,
  )
})

test('a Discord reply keeps the quoted message as metadata', () => {
  const metadata = {
    version: 1,
    sender: { type: 'user', id: 'sender', displayName: 'Yuanlin' },
    source: 'discord',
    sentAt: '2026-10-13T00:00:00Z',
    replyTo: { authorName: 'Can', text: 'Customers are asking for a DPA' },
  }

  assert.deepEqual(parseMessageMetadata(metadata)?.replyTo, metadata.replyTo)
  assert.equal(parseMessageMetadata({ ...metadata, replyTo: { text: 'x' } })?.replyTo, undefined)
  assert.equal(
    parseMessageMetadata({ ...metadata, replyTo: { authorName: 'Can', text: '' } })?.replyTo,
    undefined,
  )
})

test('an unverified Discord author keeps the unattested mark, and only for Discord', () => {
  const metadata = {
    version: 1,
    sender: { type: 'user', id: 'discord:999', displayName: 'Yuanlin Lin' },
    source: 'discord',
    sentAt: '2026-10-14T00:00:00Z',
    unattested: true,
  }

  assert.equal(parseMessageMetadata(metadata)?.unattested, true)
  assert.equal(parseMessageMetadata({ ...metadata, source: 'nuphos' })?.unattested, undefined)
})

test('an agent token message is the bot, via the user it acts for', () => {
  const metadata = {
    version: 1,
    sender: {
      type: 'agent',
      id: 'token-1',
      displayName: 'Grok Bot',
      onBehalfOf: { id: 'user-1', displayName: 'Yuanlin Lin' },
    },
    source: 'nuphos',
    sentAt: '2026-10-21T00:00:00Z',
  }
  const sender = parseMessageMetadata(metadata)?.sender

  assert.deepEqual(sender?.onBehalfOf, { id: 'user-1', displayName: 'Yuanlin Lin' })
  assert.equal(sender && senderLabel(sender), 'Grok Bot · via Yuanlin Lin')
  // Without onBehalfOf a nuphos message is a user's; an agent type is refused.
  assert.equal(
    parseMessageMetadata({ ...metadata, sender: { ...metadata.sender, onBehalfOf: undefined } }),
    undefined,
  )
  // Only nuphos messages carry it.
  assert.equal(parseMessageMetadata({ ...metadata, source: 'slack' }), undefined)
  assert.equal(senderLabel({ type: 'user', id: 'u', displayName: 'Yuanlin Lin' }), 'Yuanlin Lin')
})
