import assert from 'node:assert/strict'
import test from 'node:test'

import { initiallyFolded, planCardRegions } from './planCardLayout.ts'

test('conversation plan cards start folded; standalone ones start open', () => {
  assert.equal(initiallyFolded(true), true)
  assert.equal(initiallyFolded(false), false)
})

test('a folded plan awaiting approval still shows its approve bar', () => {
  const regions = planCardRegions({
    folded: true,
    decision: 'pending',
    canApprove: true,
    canRetry: false,
    status: 'proposed',
  })

  assert.deepEqual(regions, {
    bodyOpen: false,
    showRetry: false,
    showApproveBar: true,
    showActionBar: true,
  })
})

test('folding does not change which actions are offered', () => {
  const base = {
    decision: 'pending',
    canApprove: false,
    canRetry: true,
    status: 'failed',
  } as const
  const folded = planCardRegions({ ...base, folded: true })
  const open = planCardRegions({ ...base, folded: false })

  assert.equal(folded.bodyOpen, false)
  assert.equal(open.bodyOpen, true)
  assert.equal(folded.showRetry, true)
  assert.equal(folded.showActionBar, open.showActionBar)
})

test('a decided plan keeps its status line under the folded header', () => {
  const regions = planCardRegions({
    folded: true,
    decision: 'approved',
    canApprove: true,
    canRetry: false,
    status: 'approved',
  })

  assert.equal(regions.showApproveBar, false)
  assert.equal(regions.showActionBar, true)
})

test('an idle plan without actions renders no action bar', () => {
  const regions = planCardRegions({
    folded: true,
    decision: 'pending',
    canApprove: false,
    canRetry: false,
    status: 'proposed',
  })

  assert.equal(regions.showActionBar, false)
})
