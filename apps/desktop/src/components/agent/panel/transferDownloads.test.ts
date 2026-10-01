import assert from 'node:assert/strict'
import { test } from 'node:test'

import { anchorDownloadGroups, shouldLoadTransferDownloads } from './transferDownloads.ts'

import type { Message, Tab } from './model'
import type { FileTransferGroup } from '../../../types'

function tab(overrides: Partial<Tab>): Tab {
  return {
    id: 't1',
    sessionId: 's1',
    title: 'Chat',
    messages: [{ id: 'm1', role: 'assistant', parts: [] }],
    streaming: false,
    connected: true,
    phase: null,
    streamId: null,
    streamStartedAt: null,
    error: null,
    autoResumeAttempts: 0,
    credentialAccess: {} as Tab['credentialAccess'],
    ...overrides,
  } as Tab
}

test("loads for the owner's settled conversation", () => {
  assert.equal(shouldLoadTransferDownloads(tab({})), true)
})

test("never loads a teammate's conversation, whose downloads route is owner-only", () => {
  assert.equal(shouldLoadTransferDownloads(tab({ foreign: true, readOnly: true })), false)
})

test('an owner-side read-only view still loads', () => {
  assert.equal(shouldLoadTransferDownloads(tab({ readOnly: true })), true)
})

test('skips a streaming turn, a transcript without replies, and no tab', () => {
  assert.equal(shouldLoadTransferDownloads(tab({ streaming: true })), false)
  assert.equal(shouldLoadTransferDownloads(tab({ messages: [] })), false)
  assert.equal(shouldLoadTransferDownloads(undefined), false)
})

function message(id: string, role: Message['role'], createdAt?: number): Message {
  return { id, role, parts: [], ...(createdAt === undefined ? {} : { createdAt }) }
}

function group(groupId: string, createdAt: string): FileTransferGroup {
  return {
    groupId,
    direction: 'download',
    status: 'ready',
    label: null,
    createdAt,
    expiresAt: '2026-01-02T00:00:00.000Z',
    files: [],
  }
}

const AT = (iso: string) => Date.parse(iso)

test('anchors each group to the turn that pushed it, not the newest turn', () => {
  const messages = [
    message('u1', 'user', AT('2026-01-01T00:00:00.000Z')),
    message('a1', 'assistant', AT('2026-01-01T00:01:00.000Z')),
    message('u2', 'user', AT('2026-01-01T00:02:00.000Z')),
    message('a2', 'assistant', AT('2026-01-01T00:03:00.000Z')),
  ]
  const anchored = anchorDownloadGroups(messages, [
    group('g2', '2026-01-01T00:02:30.000Z'),
    group('g1', '2026-01-01T00:00:30.000Z'),
  ])

  assert.deepEqual(
    anchored.get('a1')?.map((g) => g.groupId),
    ['g1'],
  )
  assert.deepEqual(
    anchored.get('a2')?.map((g) => g.groupId),
    ['g2'],
  )
})

test('a group newer than every stored reply belongs to the turn that just finished', () => {
  const messages = [
    message('a1', 'assistant', AT('2026-01-01T00:01:00.000Z')),
    message('u2', 'user'),
    message('a2', 'assistant'),
  ]
  const anchored = anchorDownloadGroups(messages, [group('g1', '2026-01-01T00:05:00.000Z')])

  assert.deepEqual(
    anchored.get('a2')?.map((g) => g.groupId),
    ['g1'],
  )
})

test('several groups from one turn keep push order', () => {
  const messages = [message('a1', 'assistant', AT('2026-01-01T00:01:00.000Z'))]
  const anchored = anchorDownloadGroups(messages, [
    group('second', '2026-01-01T00:00:40.000Z'),
    group('first', '2026-01-01T00:00:20.000Z'),
  ])

  assert.deepEqual(
    anchored.get('a1')?.map((g) => g.groupId),
    ['first', 'second'],
  )
})

test('an unstamped transcript stacks every card under the last reply', () => {
  const messages = [message('a1', 'assistant'), message('u2', 'user'), message('a2', 'assistant')]
  const anchored = anchorDownloadGroups(messages, [
    group('g1', '2026-01-01T00:00:30.000Z'),
    group('g2', '2026-01-01T00:02:30.000Z'),
  ])

  assert.equal(anchored.size, 1)
  assert.deepEqual(
    anchored.get('a2')?.map((g) => g.groupId),
    ['g1', 'g2'],
  )
})

test('no assistant message means nothing to anchor to', () => {
  const anchored = anchorDownloadGroups(
    [message('u1', 'user', AT('2026-01-01T00:00:00.000Z'))],
    [group('g1', '2026-01-01T00:00:30.000Z')],
  )

  assert.equal(anchored.size, 0)
})
