import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTriggerRows,
  filterTriggerRows,
  rowPrincipalIds,
  rowSearchText,
  rowTypeLabel,
} from './triggerRows.ts'

import type { AgentTrigger, AgentTriggerGroup } from '../../api'

function trigger(over: Partial<AgentTrigger> & { id: string; name: string }): AgentTrigger {
  return {
    userId: 'u1',
    triggerType: 'cron',
    messageTemplate: 'go',
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as AgentTrigger
}

function group(over: Partial<AgentTriggerGroup> & { id: string; name: string }): AgentTriggerGroup {
  return {
    userId: 'u1',
    teamId: 't1',
    messageTemplate: 'go',
    memberKeys: [],
    expectedMemberCount: 20,
    partitionCount: 1,
    readyPartitionCount: 1,
    failedPartitionCount: 0,
    partitions: [],
    enabled: true,
    state: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as AgentTriggerGroup
}

test('a group and its standalone siblings share one list', () => {
  const rows = buildTriggerRows(
    [trigger({ id: 'a', name: 'Daily cost' }), trigger({ id: 'b', name: 'Ship note' })],
    [group({ id: 'g1', name: 'Grafana prod' })],
  )

  assert.deepEqual(
    rows.map((row) => row.key),
    ['g1', 'a', 'b'],
  )
})

test('a trigger that belongs to a listed group is not also listed on its own', () => {
  // One partition trigger serves the whole group; showing it twice would read
  // as two separate automations.
  const rows = buildTriggerRows(
    [trigger({ id: 'a', name: 'Grafana prod · grafana', watchGroupId: 'g1' })],
    [group({ id: 'g1', name: 'Grafana prod' })],
  )

  assert.deepEqual(
    rows.map((row) => row.key),
    ['g1'],
  )
})

test('a trigger whose group is missing stays visible rather than vanishing', () => {
  const rows = buildTriggerRows([trigger({ id: 'a', name: 'Orphan', watchGroupId: 'gone' })], [])

  assert.deepEqual(
    rows.map((row) => row.key),
    ['a'],
  )
})

test('Type says how a row fires, and a group fires by webhook like its partitions', () => {
  // A group is a container, not a third way of firing: every partition trigger
  // behind it is webhook-driven, so claiming a separate type would hide that.
  assert.equal(rowTypeLabel(buildTriggerRows([], [group({ id: 'g1', name: 'G' })])[0]!), 'Webhook')
  assert.equal(rowTypeLabel(buildTriggerRows([trigger({ id: 'a', name: 'A' })], [])[0]!), 'Cron')
})

test('the type filter has exactly the two ways a trigger fires', () => {
  // Being a group is not a third way of firing, so it is not a type filter;
  // the row says it with a tag, and search finds it by the word.
  const rows = buildTriggerRows(
    [
      trigger({ id: 'a', name: 'Daily', triggerType: 'cron' }),
      trigger({ id: 'b', name: 'Hook', triggerType: 'webhook' }),
    ],
    [group({ id: 'g1', name: 'Grafana' })],
  )

  const keys = (type: Parameters<typeof filterTriggerRows>[1]['type']) =>
    filterTriggerRows(rows, { type, status: 'all', principalId: null }).map((row) => row.key)

  assert.deepEqual(keys('all'), ['g1', 'a', 'b'])
  assert.deepEqual(keys('cron'), ['a'])
  // The group's partitions are webhook triggers, so it belongs here.
  assert.deepEqual(keys('webhook'), ['g1', 'b'])
})

test('the status filter reads a group state, not its enabled flag', () => {
  // A group can be enabled and still not running — provisioning, or partially
  // failed. "Active" has to mean actually firing.
  const rows = buildTriggerRows(
    [trigger({ id: 'a', name: 'On' }), trigger({ id: 'b', name: 'Off', enabled: false })],
    [
      group({ id: 'g1', name: 'Live' }),
      group({ id: 'g2', name: 'Broken', enabled: true, state: 'partial' }),
    ],
  )

  assert.deepEqual(
    filterTriggerRows(rows, { type: 'all', status: 'active', principalId: null }).map(
      (row) => row.key,
    ),
    ['g1', 'a'],
  )
  assert.deepEqual(
    filterTriggerRows(rows, { type: 'all', status: 'paused', principalId: null }).map(
      (row) => row.key,
    ),
    ['g2', 'b'],
  )
})

test('the principal filter reads whoever the row actually executes as', () => {
  // Not the creator: a transferred trigger runs with someone else's
  // permissions, and "Runs as" is the column this filter is narrowing.
  const rows = buildTriggerRows(
    [
      trigger({ id: 'a', name: 'Mine', userId: 'u1', executionPrincipalUserId: 'u2' }),
      trigger({ id: 'b', name: 'Theirs', userId: 'u2' }),
      trigger({ id: 'c', name: 'Creator only', userId: 'u9', createdByUserId: 'u1' }),
    ],
    [group({ id: 'g1', name: 'Grafana', userId: 'u2' })],
  )

  assert.deepEqual(
    filterTriggerRows(rows, { type: 'all', status: 'all', principalId: 'u2' }).map(
      (row) => row.key,
    ),
    ['g1', 'a', 'b'],
  )
  assert.deepEqual(
    filterTriggerRows(rows, { type: 'all', status: 'all', principalId: 'u1' }).map(
      (row) => row.key,
    ),
    ['c'],
  )
})

test('search text covers the name and the schedule, so "daily" finds a daily cron', () => {
  const rows = buildTriggerRows(
    [trigger({ id: 'a', name: 'Cost check', cronExpression: '0 10 * * *' })],
    [],
  )

  assert.match(rowSearchText(rows[0]!), /Cost check/)
  assert.match(rowSearchText(rows[0]!), /every day at 10:00/)
})

test('search text still finds a group by the word "group"', () => {
  // The Type column no longer says it, so the word has to reach search from
  // the row's kind instead.
  const rows = buildTriggerRows([], [group({ id: 'g1', name: 'Grafana prod' })])

  assert.match(rowSearchText(rows[0]!), /Grafana prod/)
  assert.match(rowSearchText(rows[0]!), /Group/)
})

test('only principals that own something are offered as a filter', () => {
  // A member who owns nothing can only ever produce an empty list, so offering
  // them is indistinguishable from a broken filter.
  const rows = buildTriggerRows(
    [
      trigger({ id: 'a', name: 'A', userId: 'owner-1' }),
      trigger({ id: 'b', name: 'B', userId: 'owner-1' }),
    ],
    [group({ id: 'g1', name: 'G', userId: 'owner-2' })],
  )

  assert.deepEqual(rowPrincipalIds(rows), ['owner-2', 'owner-1'])
})

test('the offered principal is the one the Runs as column shows', () => {
  // Both read rowPrincipalUserId, so a transferred trigger is offered under
  // whoever executes it — not whoever created it.
  const rows = buildTriggerRows(
    [trigger({ id: 'a', name: 'A', userId: 'creator', executionPrincipalUserId: 'runner' })],
    [],
  )

  assert.deepEqual(rowPrincipalIds(rows), ['runner'])
  assert.deepEqual(
    filterTriggerRows(rows, { type: 'all', status: 'all', principalId: 'runner' }).map(
      (row) => row.key,
    ),
    ['a'],
  )
})
