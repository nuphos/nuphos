import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  changeStatus,
  pullStateColor,
  resourceDraft,
  resourceMark,
  resourceStatus,
} from './sessionResourcePresentation.ts'

import type { SessionResource } from '../../api/session-resource-types'

const resource = (overrides: Partial<SessionResource>): SessionResource => ({
  id: 'r1',
  provider: 'github',
  title: 'Fix chips',
  url: 'https://github.com/o/r/pull/1',
  state: 'open',
  linkedAt: '2026-10-21T00:00:00Z',
  ...overrides,
})

test('a draft PR says draft, and what holds it up, the way GitHub does', () => {
  assert.equal(resourceStatus(resource({ draft: true })), 'draft')
  assert.equal(
    resourceStatus(resource({ draft: true, health: 'checks_failed' })),
    'draft · checks failing',
  )
  assert.equal(
    resourceStatus(resource({ draft: true, health: 'changes_requested' })),
    'draft · changes requested',
  )
  assert.equal(
    resourceStatus(resource({ draft: true, health: 'conflict' })),
    'draft · merge conflict',
  )
  assert.equal(resourceStatus(resource({ draft: false })), 'open')
})

test('a draft PR tag is grey; merged and closed keep their colors', () => {
  assert.equal(pullStateColor(resource({ draft: true })), 'text-secondary')
  assert.equal(pullStateColor(resource({ draft: true, health: 'conflict' })), 'text-secondary')
  assert.equal(pullStateColor(resource({ draft: false })), 'session-resource-open')
  assert.equal(
    pullStateColor(resource({ draft: true, state: 'closed' })),
    'session-resource-closed',
  )
  assert.equal(
    pullStateColor(resource({ draft: true, state: 'merged' })),
    'session-resource-merged',
  )
})

test('a draft keeps its marks and stays among the open chips', () => {
  assert.equal(resourceMark(resource({ draft: true, health: 'conflict' }))?.glyph, 'conflict')
  assert.equal(changeStatus(resource({ draft: true })), 'open')
  assert.equal(resourceDraft(resource({ draft: true, state: 'closed' })), false)
  assert.equal(resourceDraft(resource({ provider: 'linear', draft: true })), false)
})
