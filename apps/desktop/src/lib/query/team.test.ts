import assert from 'node:assert/strict'
import { test } from 'node:test'

import { QueryObserver } from '@tanstack/react-query'

import { createQueryClient } from './client.ts'
import { queryKeys } from './keys.ts'
import { teamMembersQuery, teamMembersReadNow, teamRosterQuery } from './team.ts'

import type { TeamMember } from '../../types/team.ts'

const member = (id: string) => ({ id }) as TeamMember
const refusal = new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: 'No', code: 'x' })}`)

function counted(answer: (teamId: string, removed?: boolean) => Promise<TeamMember[]>) {
  const calls: string[] = []
  const read = (teamId: string, removed?: boolean) => {
    calls.push(removed ? `${teamId}+removed` : teamId)

    return answer(teamId, removed)
  }

  return { calls, read }
}

test('every view asking at once shares one read', async () => {
  const client = createQueryClient()
  const { calls, read } = counted(async () => [member('a')])

  await Promise.all([1, 2, 3, 4].map(() => client.query(teamMembersQuery('t1', read))))
  assert.deepEqual(calls, ['t1'])
})

test('one team never answers for another', async () => {
  const client = createQueryClient()
  const { read } = counted(async (teamId) => [member(`admin-of-${teamId}`)])

  assert.equal((await client.query(teamMembersQuery('t1', read)))[0]?.id, 'admin-of-t1')
  assert.equal((await client.query(teamMembersQuery('t2', read)))[0]?.id, 'admin-of-t2')
})

test('a failed read is not kept, so the next view asks again', async () => {
  const client = createQueryClient()
  let fail = true
  const { calls, read } = counted(async () => {
    if (fail) throw refusal

    return [member('a')]
  })

  await assert.rejects(client.query(teamMembersQuery('t1', read)))
  fail = false
  assert.equal((await client.query(teamMembersQuery('t1', read))).length, 1)
  assert.deepEqual(calls, ['t1', 't1'])
})

test('a fresh answer is reused until the team is refreshed, roster included', async () => {
  const client = createQueryClient()
  const { calls, read } = counted(async () => [member('a')])

  await client.query(teamMembersQuery('t1', read))
  await client.query(teamRosterQuery('t1', read))
  await client.query(teamMembersQuery('t1', read))
  assert.deepEqual(calls, ['t1', 't1+removed'])

  await client.invalidateQueries({ queryKey: queryKeys.team('t1') })
  await client.query(teamMembersQuery('t1', read))
  await client.query(teamRosterQuery('t1', read))
  assert.deepEqual(calls, ['t1', 't1+removed', 't1', 't1+removed'])
})

test('a view that decides once from the members waits for a read made now', async () => {
  const client = createQueryClient()
  let joined = false
  const { calls, read } = counted(async () => (joined ? [member('a'), member('b')] : [member('a')]))

  await client.query(teamMembersQuery('t1', read))
  joined = true
  const observer = new QueryObserver(client, teamMembersReadNow('t1', read))

  assert.equal(observer.getOptimisticResult(observer.options).isFetchedAfterMount, false)
  const ids = await new Promise<string[]>((resolve) => {
    const stop = observer.subscribe((result) => {
      if (!result.isFetchedAfterMount) return
      stop()
      resolve((result.data ?? []).map((entry) => entry.id))
    })
  })

  assert.deepEqual(ids, ['a', 'b'])
  assert.deepEqual(calls, ['t1', 't1'])
})
