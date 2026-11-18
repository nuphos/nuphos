import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  editsRuntime,
  fallbackCandidates,
  offersFallbackSetup,
  saveFallbackThenMove,
} from './runtimeFallback.ts'

import type { RuntimeInstance } from '../../types/runtime.ts'

const runtime = (id: string, extra: Partial<RuntimeInstance> = {}) =>
  ({
    id,
    label: id,
    provider: 'claude-code',
    kind: 'local',
    status: 'active',
    ...extra,
  }) as RuntimeInstance
const studio = runtime('studio')
const offer = {
  cause: 'usage_limit',
  runtime: studio,
  edits: true,
  canMove: true,
  fallbacks: {},
}

test('a turn its runtime could not run offers a fallback while that runtime has none', () => {
  assert.equal(offersFallbackSetup(offer), true)
})

test('a fallback that exists already moves the Task by itself: nothing to set up', () => {
  assert.equal(offersFallbackSetup({ ...offer, fallbacks: { studio: 'cloud' } }), false)
  // Another runtime's fallback is not this one's.
  assert.equal(offersFallbackSetup({ ...offer, fallbacks: { cloud: 'studio' } }), true)
})

test('only a runtime-caused failure, and only once the team’s fallbacks are known', () => {
  assert.equal(offersFallbackSetup({ ...offer, cause: undefined }), false)
  assert.equal(offersFallbackSetup({ ...offer, fallbacks: undefined }), false)
  assert.equal(offersFallbackSetup({ ...offer, runtime: undefined }), false)
})

test('someone who may not set the fallback, or may not move this Task, is not offered it', () => {
  assert.equal(offersFallbackSetup({ ...offer, edits: false }), false)
  assert.equal(offersFallbackSetup({ ...offer, canMove: false }), false)
})

test('the runtime details panel and a failed turn share who edits a runtime', () => {
  assert.equal(editsRuntime(studio, true), true)
  assert.equal(editsRuntime(studio, false), false)
  assert.equal(editsRuntime(runtime('dev', { kind: 'development' }), true), false)
  assert.equal(
    editsRuntime(runtime('going', { deletion: {} as RuntimeInstance['deletion'] }), true),
    false,
  )
})

test('any other runtime that is on can take over; none left is an empty list', () => {
  const cloud = runtime('cloud')
  const off = runtime('off', { status: 'disabled' })

  assert.deepEqual(fallbackCandidates([studio, cloud, off], 'studio'), [cloud])
  assert.deepEqual(fallbackCandidates([studio, off], 'studio'), [])
})

test('saving moves the Task only after the shared setting is saved', async () => {
  const steps: string[] = []
  const moved = await saveFallbackThenMove(
    async () => {
      steps.push('save')
    },
    () => steps.push('move'),
  )

  assert.equal(moved, true)
  assert.deepEqual(steps, ['save', 'move'])
})

test('a save that fails moves nothing', async () => {
  let moves = 0
  const moved = await saveFallbackThenMove(
    () => Promise.reject(new Error('403')),
    () => moves++,
  )

  assert.equal(moved, false)
  assert.equal(moves, 0)
})
