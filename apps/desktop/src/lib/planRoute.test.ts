import assert from 'node:assert/strict'
import test from 'node:test'

import { planNumberFromFilter } from './planRoute.ts'

test('planNumberFromFilter recognizes standalone plan detail routes', () => {
  assert.equal(planNumberFromFilter('495'), '495')
  assert.equal(planNumberFromFilter(' #495 '), '495')
})

test('planNumberFromFilter leaves ordinary Plans searches on the list page', () => {
  assert.equal(planNumberFromFilter('Tencent reinstall'), null)
  assert.equal(planNumberFromFilter('495 pending'), null)
  assert.equal(planNumberFromFilter(''), null)
})
