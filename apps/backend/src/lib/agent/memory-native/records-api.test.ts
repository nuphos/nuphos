import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import {
  encodeNativeMemoryCursor,
  playbookToItem,
  keysetFilter,
  parseNativeMemoryCursor,
} from './records-api'

import type { AgentTeamMemory } from './types'

describe('native memory cursor', () => {
  test('round-trips through encode/parse', () => {
    const cursor = {
      g: { t: '2026-07-14T00:00:00.000Z', id: new ObjectId().toHexString() },
      gd: true,
      r: { t: '2026-07-01T12:34:56.000Z', id: new ObjectId().toHexString() },
      rd: false,
    }
    const encoded = encodeNativeMemoryCursor(cursor)

    expect(encoded).toStartWith('native-memory:')
    expect(parseNativeMemoryCursor(encoded!)).toEqual(cursor)
  })

  test('null when both sources exhausted (hasMore contract)', () => {
    expect(encodeNativeMemoryCursor({ g: null, gd: true, r: null, rd: true })).toBeNull()
  })

  test('missing, foreign, or corrupt cursor resets to page 1', () => {
    const start = { g: null, gd: false, r: null, rd: false }

    expect(parseNativeMemoryCursor(undefined)).toEqual(start)
    // Migration coverage: an in-flight client can still carry a cursor minted
    // under the old `team-memory:` module prefix — it must reset, not throw.
    expect(parseNativeMemoryCursor('team-memory:whatever')).toEqual(start)
    expect(parseNativeMemoryCursor('native-memory:%7Bnot-json')).toEqual(start)
  })

  test('well-formed cursor with a garbage timestamp resets to page 1, not Invalid Date', () => {
    const id = new ObjectId().toHexString()

    expect(keysetFilter('createdAt', { t: 'not-a-date', id })).toEqual({})
    expect(keysetFilter('createdAt', { t: '2026-07-01T00:00:00.000Z', id })).not.toEqual({})
  })
})

describe('playbookToItem', () => {
  const playbook: AgentTeamMemory = {
    _id: new ObjectId(),
    teamId: 'team-1',
    lineageId: 'abc',
    status: 'active',
    revision: 1,
    gene: {
      title: 'Pod OOM triage',
      triggerSignals: ['oom', '137'],
      investigationPath: [{ action: 'describe pod', check: 'exit 137?', nextWhen: 'yes' }],
      traps: ['137 is not always OOM'],
      doNotUseWhen: ['user asked for a restart'],
    },
    capsules: [
      {
        outcome: 'confirmed',
        problem: 'p',
        actions: ['a'],
        verification: ['v'],
        conversationId: 'conv-9',
        toolCallIds: [],
        authorUserId: 'u1',
        observedAt: new Date(),
      },
    ],
    createdBy: 'u1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedBy: 'u1',
    updatedAt: new Date('2026-07-02T00:00:00Z'),
  }

  test('maps to the wire DTO field-for-field', () => {
    const item = playbookToItem(playbook)

    expect(item).toEqual({
      id: playbook._id.toHexString(),
      type: 'artifact',
      text: expect.stringContaining('Pod OOM triage'),
      // Internal vocabulary never reaches user surfaces (naming discipline).
      categories: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
      convId: 'conv-9',
      userId: 'u1',
      appId: null,
      groupIds: [],
      gene: {
        title: 'Pod OOM triage',
        triggerSignals: ['oom', '137'],
        investigationPath: [{ action: 'describe pod', check: 'exit 137?', nextWhen: 'yes' }],
        traps: ['137 is not always OOM'],
        doNotUseWhen: ['user asked for a restart'],
        status: 'active',
        revision: 1,
      },
    })
    expect(item.text).toContain('Signals: oom, 137')
    expect(item.text).toContain('1. describe pod — exit 137? (next when: yes)')
    expect(item.text).toContain('Traps:')
    expect(item.text).toContain('Do not use when:')
  })

  test('non-active status becomes a visible category', () => {
    expect(playbookToItem({ ...playbook, status: 'needs_review' }).categories).toEqual([
      'needs_review',
    ])
  })

  test('cases are detail-only: list DTO omits them, includeCapsules maps them (item 6)', () => {
    expect(playbookToItem(playbook).gene?.capsules).toBeUndefined()
    const detail = playbookToItem(playbook, { includeCapsules: true })

    expect(detail.gene?.capsules).toEqual([
      {
        outcome: 'confirmed',
        problem: 'p',
        actions: ['a'],
        verification: ['v'],
        conversationId: 'conv-9',
        observedAt: playbook.capsules[0]!.observedAt.toISOString(),
      },
    ])
    // Internal-only fields never reach the wire.
    expect(JSON.stringify(detail)).not.toContain('toolCallIds')
    expect(JSON.stringify(detail)).not.toContain('authorUserId')
  })

  test('malformed playbook (missing arrays) degrades to a sparse item, no throw', () => {
    const malformed = {
      ...playbook,
      gene: { title: 'bare title' },
    } as unknown as AgentTeamMemory
    const item = playbookToItem(malformed)

    expect(item.text).toContain('bare title')
    expect(item.text).not.toContain('Traps:')
  })
})

// buildMemorySavedFrame retired with the Phase 2 PR 3 swap — the runtime's
// renderMemorySavedFrame owns the wire frame now, golden-locked by
// memory-slots/save-frame.test.ts.
