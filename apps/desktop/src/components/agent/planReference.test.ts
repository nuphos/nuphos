import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  extractPersistedPlanId,
  findLatestConversationPlanId,
  findLatestPlanReference,
  isPlanProposalToolName,
} from './planReference.ts'

test('extracts ids from standard and typed resource Plan responses', () => {
  assert.equal(extractPersistedPlanId({ planId: '295' }), '295')
  assert.equal(extractPersistedPlanId({ ok: true, plan: { id: '296' } }), '296')
  assert.equal(extractPersistedPlanId({ ok: false, error: 'denied' }), null)
})

test('discovers the latest durable Plan when its live tool frame was dropped', () => {
  assert.equal(
    findLatestConversationPlanId(
      [
        { id: '10', sourceConversationId: 'other', createdAt: '2026-08-24T10:00:00Z' },
        { id: '11', sourceConversationId: 'conversation-1', createdAt: '2026-08-24T10:01:00Z' },
        { id: '12', sourceConversationId: 'conversation-1', createdAt: '2026-08-24T10:02:00Z' },
      ],
      'conversation-1',
    ),
    '12',
  )
})

test('recognizes database change proposals as persisted Plan producers', () => {
  assert.equal(isPlanProposalToolName('plan_create'), true)
  assert.equal(isPlanProposalToolName('database_change_propose'), true)
  assert.equal(isPlanProposalToolName('database_change_status'), false)
})

test('selects the latest Plan-producing tool in a conversation', () => {
  const reference = findLatestPlanReference([
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool',
          toolCallId: 'cloud-plan',
          toolName: 'plan_create',
          output: { planId: '295' },
        },
      ],
    },
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool',
          toolCallId: 'database-plan',
          toolName: 'database_change_propose',
          output: { ok: true, plan: { id: '296' } },
        },
      ],
    },
  ])

  assert.deepEqual(reference, { toolCallId: 'database-plan', planId: '296' })
})
