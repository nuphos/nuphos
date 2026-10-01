import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rollupPlanStatus, isPlanStatusActive, resolveStepStatuses } from './planStepStatus.ts'

test('a step with no commands has no status of its own', () => {
  assert.equal(rollupPlanStatus(undefined), null)
  assert.equal(rollupPlanStatus([]), null)
})

test('only a literal running command makes a step active', () => {
  assert.equal(rollupPlanStatus(['running', 'pending']), 'running')
  assert.equal(rollupPlanStatus(['done', 'running']), 'running')
  assert.equal(isPlanStatusActive(rollupPlanStatus(['running'])), true)
})

test('a half-finished step is partial, not running', () => {
  // The regression: `some(s => s !== 'pending')` called this 'running', so
  // every step the agent had touched spun forever, several at once.
  assert.equal(rollupPlanStatus(['done', 'pending']), 'partial')
  assert.equal(rollupPlanStatus(['done', 'done', 'pending']), 'partial')
  assert.equal(isPlanStatusActive(rollupPlanStatus(['done', 'pending'])), false)
})

test('two half-finished steps are never both active', () => {
  const steps = [
    ['done', 'done', 'pending'],
    ['done', 'pending', 'pending'],
  ] as const
  const active = steps.filter((s) => isPlanStatusActive(rollupPlanStatus(s)))

  assert.equal(active.length, 0)
})

test('failure wins over everything, including work still in flight', () => {
  assert.equal(rollupPlanStatus(['failed']), 'failed')
  assert.equal(rollupPlanStatus(['done', 'failed', 'running']), 'failed')
  assert.equal(rollupPlanStatus(['failed', 'pending']), 'failed')
})

test('done requires every command to be done', () => {
  assert.equal(rollupPlanStatus(['done', 'done']), 'done')
  assert.equal(rollupPlanStatus(['done', 'done', 'running']), 'running')
})

test('an untouched step stays pending', () => {
  assert.equal(rollupPlanStatus(['pending']), 'pending')
  assert.equal(rollupPlanStatus(['pending', 'pending']), 'pending')
})

test('a stale running marker never makes a second step active', () => {
  // The agent marked step 1 running, moved on without closing it, then marked
  // step 3 running. Only the step it actually moved to may claim to be active.
  const resolved = resolveStepStatuses([
    ['running', 'pending'],
    ['done', 'done'],
    ['running', 'pending'],
  ])

  assert.deepEqual(resolved, ['partial', 'done', 'running'])
  assert.equal(resolved.filter(isPlanStatusActive).length, 1)
})

test('resolution leaves a well-behaved plan untouched', () => {
  assert.deepEqual(resolveStepStatuses([['done', 'done'], ['running', 'pending'], ['pending']]), [
    'done',
    'running',
    'pending',
  ])
})

test('resolution never invents activity where the plan records none', () => {
  const resolved = resolveStepStatuses([['done', 'pending'], ['pending'], undefined])

  assert.deepEqual(resolved, ['partial', 'pending', null])
  assert.equal(resolved.filter(isPlanStatusActive).length, 0)
})

test('a failed step still reads as failed even with a later running step', () => {
  assert.deepEqual(resolveStepStatuses([['failed'], ['running']]), ['failed', 'running'])
})
