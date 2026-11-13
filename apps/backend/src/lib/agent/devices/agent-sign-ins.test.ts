import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

const updates: { filter: unknown; update: unknown }[] = []
const audits: Record<string, unknown>[] = []
let device: Record<string, unknown> | null = null

useDb({
  db: () => ({
    collection: () => ({
      findOneAndUpdate: (filter: unknown, update: unknown) => {
        updates.push({ filter, update })

        return Promise.resolve(device)
      },
      updateOne: (filter: unknown, update: unknown) => {
        updates.push({ filter, update })

        return Promise.resolve({ matchedCount: 1 })
      },
      insertOne: (doc: Record<string, unknown>) => {
        audits.push(doc)

        return Promise.resolve({ acknowledged: true })
      },
    }),
  }),
})

const { recordAgentSignIn } = await import('./agent-sign-ins')

const grant = { teamId: 't1', everyone: false, userIds: ['mate'], managerIds: [] as string[] }

beforeEach(() => {
  updates.length = 0
  audits.length = 0
  device = {
    _id: 'd1',
    userId: 'host',
    deviceId: 'box-1',
    box: { teamId: 't1', createdBy: 'host' },
    access: [grant],
  }
})

test('a use-list member signing a Box agent in is recorded and audited', async () => {
  await recordAgentSignIn(
    't1',
    'local_host_box-1_codex_00000000-0000-4000-8000-000000000002',
    'mate',
    false,
  )

  expect(updates).toHaveLength(1)
  expect(updates[0]?.filter).toEqual({ userId: 'host', deviceId: 'box-1' })
  // One pipeline update: the agent's entry is replaced, never added beside an older one.
  const [stage] = updates[0]?.update as { $set: { signIns: { $concatArrays: unknown[] } } }[]
  const [kept, added] = stage!.$set.signIns.$concatArrays as [
    { $filter: { cond: unknown } },
    { $literal: { key: string; userId: string } }[],
  ]

  expect(kept.$filter.cond).toEqual({
    $ne: ['$$this.key', { $literal: '00000000-0000-4000-8000-000000000002' }],
  })
  expect(added[0]).toMatchObject({
    $literal: { key: '00000000-0000-4000-8000-000000000002', userId: 'mate' },
  })
  const access = { everyone: false, userIds: ['mate'], managerIds: [] }

  expect(audits).toEqual([
    expect.objectContaining({
      deviceId: 'box-1',
      teamId: 't1',
      actorUserId: 'mate',
      actorAuthority: 'use',
      via: 'agent_sign_in',
      previous: access,
      next: access,
      agent: { provider: 'codex', instanceId: '00000000-0000-4000-8000-000000000002' },
    }),
  ])
})

test('a sign-out forgets who signed in and is audited as one', async () => {
  await recordAgentSignIn('t1', 'local_host_box-1', 'host', true)

  expect(updates).toHaveLength(1)
  expect((updates[0]?.update as { $set: { signIns: unknown } }[])[0]?.$set.signIns).toHaveProperty(
    '$filter',
  )
  expect(audits[0]).toMatchObject({ actorAuthority: 'owner', agent: { signedOut: true } })
})

test('a team runtime or a vanished computer records nothing', async () => {
  await recordAgentSignIn('t1', 'managed-1', 'admin', false)
  device = null
  await recordAgentSignIn('t1', 'local_host_box-1', 'mate', false)

  expect(updates).toHaveLength(1)
  expect(audits).toEqual([])
})
