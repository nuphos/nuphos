import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  anchorDownloadGroups,
  filesBesidePreviews,
  previewKind,
  shouldLoadTransferDownloads,
} from './transferDownloads.ts'

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

test('loads an idle runtime conversation that stays attached to its stream', () => {
  // A reopened runtime conversation keeps its transport open while idle.
  assert.equal(shouldLoadTransferDownloads(tab({ streaming: true })), true)
})

test("never loads a teammate's conversation, whose downloads route is owner-only", () => {
  assert.equal(shouldLoadTransferDownloads(tab({ foreign: true, readOnly: true })), false)
})

test('an owner-side read-only view still loads', () => {
  assert.equal(shouldLoadTransferDownloads(tab({ readOnly: true })), true)
})

test('skips an executing turn, a transcript without replies, and no tab', () => {
  const executing = { state: 'active', observedAt: performance.now() } as Tab['runtimeState']

  assert.equal(shouldLoadTransferDownloads(tab({ runtimeState: executing })), false)
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

function file(
  over: Partial<FileTransferGroup['files'][number]>,
): FileTransferGroup['files'][number] {
  return {
    id: 'f',
    fileName: 'a.bin',
    relPath: 'a.bin',
    size: 1,
    contentType: null,
    status: 'ready',
    ...over,
  }
}

test('previews ready images and videos by content type, or by name when it is missing', () => {
  assert.equal(previewKind(file({ contentType: 'image/png', fileName: 'shot' })), 'image')
  assert.equal(previewKind(file({ fileName: 'Shot.PNG' })), 'image')
  assert.equal(previewKind(file({ contentType: 'video/quicktime', fileName: 'rec' })), 'video')
  assert.equal(previewKind(file({ fileName: 'm1-screen-recording.mov' })), 'video')
  assert.equal(previewKind(file({ contentType: 'text/plain', fileName: 'x.png' })), null)
  assert.equal(previewKind(file({ fileName: 'run.log' })), null)
  assert.equal(previewKind(file({ fileName: 'shot.png', status: 'pending' })), null)
})

test('rows beside previews hold back only images that became thumbnails', () => {
  const files = [
    { fileName: 'a.png', status: 'ready' },
    { fileName: 'b.png', status: 'failed' },
    { fileName: 'c.png', status: 'ready' },
    { fileName: 'clip.mp4', status: 'ready' },
    { fileName: 'notes.pdf', status: 'ready' },
  ]
  const names = (rows: typeof files) => rows.map((f) => f.fileName)

  // Resolving: ready images are expected to preview; everything else is listed.
  assert.deepEqual(names(filesBesidePreviews(files, null)), ['b.png', 'clip.mp4', 'notes.pdf'])
  // Resolved without c.png (no link): it comes back as a row instead of vanishing.
  assert.deepEqual(names(filesBesidePreviews(files, new Set(['a.png']))), [
    'b.png',
    'c.png',
    'clip.mp4',
    'notes.pdf',
  ])
  // Nothing resolved (expired, someone else's files): every file is a row.
  assert.deepEqual(names(filesBesidePreviews(files, new Set())), names(files))
})
