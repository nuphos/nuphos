import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseMessageMetadata } from './messageMetadata.ts'
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
})
