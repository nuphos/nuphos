import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isChatSummaryShortcut } from '../../../lib/chatSummaryPanel.ts'
import { EMPTY_CREDENTIAL_ACCESS } from '../panel/constants.ts'

import {
  changeCounts,
  changeStatusLabel,
  changeSubtitle,
  changeTitle,
  changesFilterOptions,
  changesOf,
  connectorCount,
  deviceCount,
  filterChanges,
  filterSubAgents,
  findConversation,
  machineName,
  outputFilesOf,
  shownChangesFilter,
  shownSubAgentsFilter,
  splitFileName,
  subAgentsFilterOptions,
  subAgentsOf,
  subThreadsOf,
} from './chatSummaryModel.ts'

import type { SubAgent } from './chatSummaryModel.ts'
import type { AgentConversation } from '../../../api/agent-types.ts'
import type { SessionResource } from '../../../api/session-resource-types.ts'
import type { ChangesFilter, SubAgentsFilter } from '../../../lib/chatSummaryPanel.ts'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'
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

test('an archived chat, in neither list, is the one the transcript opened', () => {
  const archived = chat('a', {
    archivedAt: '2026-10-15T00:00:00Z',
    linkedResources: [resource({})],
  })

  assert.equal(findConversation('a', [[], [chat('b')]], archived), archived)
  // A listed chat stays the live one; an opened chat from another session is ignored.
  const listed = chat('a', { title: 'listed' })

  assert.equal(findConversation('a', [[listed]], archived), listed)
  assert.equal(findConversation('c', [[listed]], archived), undefined)
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

test('connectors count leaves devices out', () => {
  const conversation = chat('a', {
    credentialAccess: { ...EMPTY_CREDENTIAL_ACCESS, awsRoleIds: ['r'], deviceIds: ['m', 'gone'] },
  })

  assert.equal(connectorCount(conversation), 1)
  assert.equal(connectorCount(undefined), 0)
})

test('⌘I toggles on macOS and Ctrl+I elsewhere, nothing with extra modifiers', () => {
  const key = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: 'KeyI',
    isComposing: false,
    target: null,
  }

  assert.equal(isChatSummaryShortcut({ ...key, metaKey: true }, true), true)
  assert.equal(isChatSummaryShortcut({ ...key, ctrlKey: true }, true), false)
  assert.equal(isChatSummaryShortcut({ ...key, ctrlKey: true }, false), true)
  assert.equal(isChatSummaryShortcut({ ...key, metaKey: true, shiftKey: true }, true), false)
})

test('⌘I is left alone while focus is in a dialog or menu', () => {
  const inside = (selector: string) => (selector.includes('dialog') ? {} : null)
  const key = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: 'KeyI',
    isComposing: false,
  }

  assert.equal(
    isChatSummaryShortcut({ ...key, target: { closest: inside } as unknown as EventTarget }, true),
    false,
  )
  assert.equal(
    isChatSummaryShortcut(
      { ...key, target: { closest: () => null } as unknown as EventTarget },
      true,
    ),
    true,
  )
})

test('the machine is named without the agent, with a fallback per runtime kind', () => {
  assert.equal(machineName('MacBook-Pro.local · Claude Code', true), 'MacBook-Pro.local')
  assert.equal(machineName(undefined, true), 'This computer')
  assert.equal(machineName('', false), 'Cloud runtime')
})

test('a long file name can be cut while its extension stays readable', () => {
  assert.deepEqual(splitFileName('chat-summary-light.png'), ['chat-summary-light', '.png'])
  assert.deepEqual(splitFileName('README'), ['README', ''])
  assert.deepEqual(splitFileName('.env'), ['.env', ''])
})

test('a stored selection missing newer credential kinds counts without throwing', () => {
  const { cloudflareAccountIds: _dropped, ...older } = {
    ...EMPTY_CREDENTIAL_ACCESS,
    awsRoleIds: ['r1'],
    deviceIds: ['d1', 'd2'],
  }
  const conversation = chat('a', {
    credentialAccess: older as AgentConversation['credentialAccess'],
  })

  assert.equal(connectorCount(conversation), 1)
  assert.equal(deviceCount(conversation), 2)
  assert.equal(deviceCount(undefined), 0)
})

const openPr = resource({ id: 'open-pr', state: 'open' })
const mergedPr = resource({ id: 'merged-pr', state: 'merged' })
const closedPr = resource({ id: 'closed-pr', state: 'closed' })
const doneIssue = resource({
  id: 'done',
  provider: 'linear',
  state: 'Done',
  stateType: 'completed',
})
const startedIssue = resource({
  id: 'started',
  provider: 'linear',
  state: 'In Progress',
  stateType: 'started',
})

test('changes are counted per status, with issues in the matching group', () => {
  assert.deepEqual(changeCounts([openPr, mergedPr, doneIssue, startedIssue, closedPr]), {
    open: 2,
    merged: 2,
    closed: 1,
  })
})

test('the merged group reads Merged with a pull request, Done with only issues', () => {
  assert.equal(changeStatusLabel('merged', [mergedPr, doneIssue]), 'Merged')
  assert.equal(changeStatusLabel('merged', [doneIssue, openPr]), 'Done')
  assert.equal(changeStatusLabel('open', [openPr]), 'Open')
  assert.equal(changeStatusLabel('closed', [closedPr]), 'Closed')
})

test('the filter offers All and each status that has changes, in a fixed order', () => {
  assert.deepEqual(changesFilterOptions([closedPr, mergedPr, openPr, mergedPr]), [
    { filter: 'all', label: 'All', count: 4 },
    { filter: 'open', label: 'Open', count: 1 },
    { filter: 'merged', label: 'Merged', count: 2 },
    { filter: 'closed', label: 'Closed', count: 1 },
  ])
  assert.deepEqual(
    changesFilterOptions([doneIssue, startedIssue]).map((option) => option.label),
    ['All', 'Open', 'Done'],
  )
})

test('the filter is hidden when every change shares one status', () => {
  assert.deepEqual(changesFilterOptions([mergedPr, doneIssue]), [])
  assert.deepEqual(changesFilterOptions([]), [])
})

function shown(stored: ChangesFilter, changes: SessionResource[]) {
  return shownChangesFilter(stored, changesFilterOptions(changes))
}

test('a stored filter that matches nothing here shows All instead', () => {
  assert.equal(shown('merged', [openPr, mergedPr]), 'merged')
  assert.equal(shown('closed', [openPr, mergedPr]), 'all')
  assert.equal(shown('merged', [mergedPr]), 'all')
  assert.equal(shown('merged', []), 'all')
  assert.equal(shown('all', [openPr, mergedPr]), 'all')
})

test('All lists open, merged, then closed, keeping link order inside each', () => {
  const newer = resource({ id: 'newer-open', state: 'open', linkedAt: '2026-10-16T00:00:00Z' })
  const changes = changesOf([closedPr, mergedPr, openPr, newer, doneIssue])

  assert.deepEqual(
    filterChanges(changes, 'all').map((change) => change.id),
    ['newer-open', 'open-pr', 'merged-pr', 'done', 'closed-pr'],
  )
  assert.deepEqual(
    filterChanges(changes, 'merged').map((change) => change.id),
    ['merged-pr', 'done'],
  )
})

const turn: RuntimeExecution = { state: 'active' }
const question: Partial<AgentConversation> = {
  inputRequests: [
    {
      id: 'q1',
      category: 'preference',
      question: 'Which region?',
      askedAt: '2026-10-27T12:00:00Z',
      status: 'open',
    },
  ],
}

const subAgents: SubAgent[] = subAgentsOf(
  [chat('done-new'), chat('running'), chat('done-old'), chat('waiting', question)],
  new Map([['running', turn]]),
)

test('sub-agents are filtered by All, Active and Done, with counts', () => {
  assert.deepEqual(subAgentsFilterOptions(subAgents), [
    { filter: 'all', label: 'All', count: 4 },
    { filter: 'active', label: 'Active', count: 2 },
    { filter: 'done', label: 'Done', count: 2 },
  ])
})

test('the sub-agents filter is hidden when every one is active or every one is done', () => {
  assert.deepEqual(subAgentsFilterOptions(filterSubAgents(subAgents, 'done')), [])
  assert.deepEqual(subAgentsFilterOptions(filterSubAgents(subAgents, 'active')), [])
  assert.deepEqual(subAgentsFilterOptions([]), [])
})

function shownSubAgents(stored: SubAgentsFilter, list: SubAgent[]) {
  return shownSubAgentsFilter(stored, subAgentsFilterOptions(list))
}

test('Active shows when a sub-agent is active, All when none is', () => {
  assert.equal(shownSubAgents('active', subAgents), 'active')
  assert.equal(shownSubAgents('active', filterSubAgents(subAgents, 'done')), 'all')
  assert.equal(shownSubAgents('done', subAgents), 'done')
  assert.equal(shownSubAgents('done', filterSubAgents(subAgents, 'active')), 'all')
})

function shownIds(filter: SubAgentsFilter) {
  return filterSubAgents(subAgents, filter).map(({ conversation }) => conversation.sessionId)
}

test('All lists active sub-agents, then done ones, keeping activity order inside each', () => {
  assert.deepEqual(shownIds('all'), ['running', 'waiting', 'done-new', 'done-old'])
  assert.deepEqual(shownIds('active'), ['running', 'waiting'])
  assert.deepEqual(shownIds('done'), ['done-new', 'done-old'])
})
