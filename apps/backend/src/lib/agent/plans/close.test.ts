import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { closePlan } from './close'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()
let resolved: [string, string][] = []

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useAgentDb({
  resolvePlanInputRequests: async (sessionId, planId) => {
    resolved.push([sessionId, planId])
  },
})

const scope = { teamId: 'team', userId: 'reviewer' }

function plan(number: number, status: string) {
  return {
    _id: `plan-${String(number)}`,
    teamId: 'team',
    createdBy: 'owner',
    sourceConversationId: `conv-${String(number)}`,
    number,
    title: `Plan ${String(number)}`,
    steps: [],
    actions: [],
    approvals: [],
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const stored = (number: number) => memory.collection('plans').findOne({ number })

beforeEach(async () => {
  memory = portabilityDb()
  resolved = []
  const plans = memory.collection('plans')

  await plans.insertOne(plan(1, 'proposed'))
  await plans.insertOne(plan(2, 'approved'))
  await plans.insertOne(plan(3, 'executing'))
})

describe('closePlan', () => {
  test('rejects a proposed Plan once and clears its question', async () => {
    const closed = await closePlan('1', { status: 'rejected', rejectedBy: 'reviewer' }, scope)

    expect(closed?.status).toBe('rejected')
    expect(await stored(1)).toMatchObject({ status: 'rejected', rejectedBy: 'reviewer' })
    expect((await stored(1))?.rejectedAt).toBeInstanceOf(Date)
    expect(resolved).toEqual([['conv-1', '1']])
    expect(await closePlan('1', { status: 'rejected', rejectedBy: 'other' }, scope)).toBeNull()
  })

  test('rejects only a Plan that still awaits a decision', async () => {
    expect(await closePlan('2', { status: 'rejected', rejectedBy: 'reviewer' }, scope)).toBeNull()
    expect((await stored(2))?.status).toBe('approved')
  })

  test('cancels a Plan until it starts', async () => {
    expect((await closePlan('1', { status: 'cancelled' }, scope))?.status).toBe('cancelled')
    expect((await closePlan('2', { status: 'cancelled' }, scope))?.status).toBe('cancelled')
    expect(await closePlan('3', { status: 'cancelled' }, scope)).toBeNull()
    expect((await stored(3))?.status).toBe('executing')
    expect(resolved).toEqual([
      ['conv-1', '1'],
      ['conv-2', '2'],
    ])
  })

  test('stays inside the caller scope', async () => {
    expect(
      await closePlan('1', { status: 'cancelled' }, { teamId: 'other', userId: 'x' }),
    ).toBeNull()
    expect((await stored(1))?.status).toBe('proposed')
  })
})
