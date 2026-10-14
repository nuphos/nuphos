import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isChatSummaryShortcut } from '../../../lib/chatSummaryPanel.ts'
import { EMPTY_CREDENTIAL_ACCESS } from '../panel/constants.ts'

import {
  changeSubtitle,
  changeTitle,
  changesOf,
  connectorCount,
  deviceLabels,
  findConversation,
  outputFilesOf,
  subThreadsOf,
} from './chatSummaryModel.ts'

import type { AgentConversation } from '../../../api/agent-types.ts'
import type { SessionResource } from '../../../api/session-resource-types.ts'
import type { FileTransferGroup } from '../../../types/app-misc.ts'

function chat(sessionId: string, extra: Partial<AgentConversation> = {}): AgentConversation {
  return {
    sessionId,
    title: sessionId,
    firstMessage: '',
    messageCount: 1,
    createdAt: '2026-10-14T00:00:00Z',
    lastActiveAt: '2026-10-14T00:00:00Z',
    ...extra,
  }
}

function resource(extra: Partial<SessionResource>): SessionResource {
  return {
    id: 'r',
    provider: 'github',
    title: 'Fix it',
    url: 'https://example.com',
    state: 'open',
    linkedAt: '2026-10-14T00:00:00Z',
    ...extra,
  }
}

test('the chat is found in the owner list before the shared list', () => {
  const own = chat('a', { title: 'own' })

  assert.equal(findConversation('a', [[own], [chat('a', { title: 'shared' })]]), own)
  assert.equal(findConversation('missing', [[own]]), undefined)
})

test('threads are this chat’s children, once each, newest activity first', () => {
  const older = chat('t1', { parentSessionId: 'p', lastActiveAt: '2026-10-14T01:00:00Z' })
  const newer = chat('t2', { parentSessionId: 'p', lastActiveAt: '2026-10-14T02:00:00Z' })
  const other = chat('t3', { parentSessionId: 'q' })

  assert.deepEqual(
    subThreadsOf('p', [
      [older, other],
      [newer, older],
    ]).map((c) => c.sessionId),
    ['t2', 't1'],
  )
})

test('changes keep pull requests and issues, newest link first', () => {
  const list = changesOf([
    resource({ id: 'pr', linkedAt: '2026-10-14T01:00:00Z' }),
    resource({ id: 'slack', provider: 'slack' }),
    resource({ id: 'issue', provider: 'linear', linkedAt: '2026-10-14T02:00:00Z' }),
  ])

  assert.deepEqual(
    list.map((r) => r.id),
    ['issue', 'pr'],
  )
})

test('a pull request reads repo and number; an issue reads its key under its title', () => {
  assert.equal(changeSubtitle(resource({ repository: 'nuphos/nuphos', number: 12 })), 'nuphos #12')
  const issue = resource({ provider: 'linear', title: 'ENG-7 Fix the panel' })

  assert.equal(changeSubtitle(issue), 'ENG-7')
  assert.equal(changeTitle(issue), 'Fix the panel')
})

function group(groupId: string, createdAt: string, expiresAt: string): FileTransferGroup {
  return {
    groupId,
    direction: 'download',
    status: 'ready',
    label: null,
    createdAt,
    expiresAt,
    files: [
      {
        id: `${groupId}-png`,
        fileName: 'a.png',
        relPath: 'a.png',
        size: 1,
        contentType: 'image/png',
        status: 'ready',
      },
      {
        id: `${groupId}-gone`,
        fileName: 'b.txt',
        relPath: 'b.txt',
        size: 1,
        contentType: null,
        status: 'failed',
      },
    ],
  }
}

test('outputs list ready files from live download groups, newest group first', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const files = outputFilesOf(
    [
      group('old', '2026-10-14T01:00:00Z', '2026-10-15T00:00:00Z'),
      group('new', '2026-10-14T02:00:00Z', '2026-10-15T00:00:00Z'),
      group('expired', '2026-10-14T03:00:00Z', '2026-10-14T11:00:00Z'),
    ],
    now,
  )

  assert.deepEqual(
    files.map((f) => f.fileId),
    ['new-png', 'old-png'],
  )
  assert.equal(files[0]?.image, true)
})

test('connectors count leaves devices out; devices resolve to their names', () => {
  const conversation = chat('a', {
    credentialAccess: { ...EMPTY_CREDENTIAL_ACCESS, awsRoleIds: ['r'], deviceIds: ['m', 'gone'] },
  })

  assert.equal(connectorCount(conversation), 1)
  assert.equal(connectorCount(undefined), 0)
  assert.deepEqual(
    deviceLabels(conversation, [{ deviceId: 'm', label: 'Mac', platform: 'darwin' }]),
    ['Mac'],
  )
})

test('⌘I toggles on macOS and Ctrl+I elsewhere, nothing with extra modifiers', () => {
  const key = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: 'KeyI',
    isComposing: false,
  }

  assert.equal(isChatSummaryShortcut({ ...key, metaKey: true }, true), true)
  assert.equal(isChatSummaryShortcut({ ...key, ctrlKey: true }, true), false)
  assert.equal(isChatSummaryShortcut({ ...key, ctrlKey: true }, false), true)
  assert.equal(isChatSummaryShortcut({ ...key, metaKey: true, shiftKey: true }, true), false)
})
