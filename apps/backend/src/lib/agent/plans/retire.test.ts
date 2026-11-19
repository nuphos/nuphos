import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { cancelOpenAgentPlans } from './retire'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()
let resolved: [string, string][] = []
let notes: { sessionId: string; text: string }[] = []

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useAgentDb({
  resolvePlanInputRequests: async (sessionId, planId) => {
    resolved.push([sessionId, planId])
  },
  appendAutonomousConversationTurn: async (data) => {
    notes.push({
      sessionId: data.sessionId,
      text: (data.message.parts[0] as { text: string }).text,
    })

    return true
  },
})

function plan(number: number, status: string, extra: Record<string, unknown> = {}) {
  return {
    _id: `plan-${String(number)}`,
    teamId: 'team',
    createdBy: 'owner',
    sourceConversationId: `conv-${String(number)}`,
    number,
    title: `Plan ${String(number)}`,
    steps: [],
    status,
    ...extra,
  }
}

beforeEach(() => {
  memory = portabilityDb()
  resolved = []
  notes = []
})

describe('cancelOpenAgentPlans', () => {
  test('cancels open agent Plans, clears their questions and tells their conversations', async () => {
    const plans = memory.collection('plans')

    await plans.insertOne(plan(1, 'proposed'))
    await plans.insertOne(plan(2, 'executing'))
    await plans.insertOne(plan(3, 'completed'))
    await plans.insertOne(plan(4, 'proposed', { actions: [{ type: 'mongodb.change' }] }))

    expect(await cancelOpenAgentPlans()).toBe(2)
    expect((await plans.findOne({ _id: 'plan-1' }))?.status).toBe('cancelled')
    expect((await plans.findOne({ _id: 'plan-2' }))?.status).toBe('cancelled')
    expect((await plans.findOne({ _id: 'plan-3' }))?.status).toBe('completed')
    expect((await plans.findOne({ _id: 'plan-4' }))?.status).toBe('proposed')
    expect(resolved).toEqual([
      ['conv-1', '1'],
      ['conv-2', '2'],
    ])
    expect(notes.map((note) => note.sessionId)).toEqual(['conv-1', 'conv-2'])
    expect(notes[0]?.text).toContain('Plan #1 "Plan 1" was cancelled')
  })

  test('is a no-op once no open agent Plan remains', async () => {
    await memory.collection('plans').insertOne(plan(1, 'proposed'))
    await cancelOpenAgentPlans()

    expect(await cancelOpenAgentPlans()).toBe(0)
    expect(notes).toHaveLength(1)
  })
})
