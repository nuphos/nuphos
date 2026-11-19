import assert from 'node:assert/strict'
import test from 'node:test'

import { canEditDashboard, moveTarget, splitByVisibility } from './visibility.ts'

import type { NuphosDashboard } from '../schema'

const personal = { createdBy: 'me', visibility: 'personal' as const }
const team = { createdBy: 'me', visibility: 'team' as const }
// From a backend that predates personal dashboards: the team's.
const legacy = { createdBy: 'someone' }

test('a personal dashboard is edited by its creator, whatever their role', () => {
  assert.equal(canEditDashboard(personal, 'me', 'VIEWER'), true)
  assert.equal(canEditDashboard(personal, 'other', 'ADMINISTRATOR'), false)
})

test('a team dashboard, or one without visibility, is edited by Administrators and Editors', () => {
  for (const dashboard of [team, legacy]) {
    assert.equal(canEditDashboard(dashboard, 'me', 'EDITOR'), true)
    assert.equal(canEditDashboard(dashboard, 'me', 'VIEWER'), false)
  }
})

test('only the creator moves a dashboard, and moving it to the team takes a write role', () => {
  assert.equal(moveTarget(personal, 'me', 'EDITOR'), 'team')
  assert.equal(moveTarget(personal, 'me', 'VIEWER'), null)
  assert.equal(moveTarget(team, 'me', 'VIEWER'), 'personal')
  assert.equal(moveTarget(team, 'other', 'ADMINISTRATOR'), null)
})

test('once its creator is no longer in the team, an Administrator holds a personal dashboard', () => {
  const left = { createdBy: 'gone', visibility: 'personal' as const }

  assert.equal(canEditDashboard(left, 'admin', 'ADMINISTRATOR'), false)
  assert.equal(canEditDashboard(left, 'admin', 'ADMINISTRATOR', false), true)
  assert.equal(moveTarget(left, 'admin', 'ADMINISTRATOR', false), 'team')
  assert.equal(moveTarget(left, 'editor', 'EDITOR', false), null)
})

test('the list splits into personal dashboards and the team’s, older ones counting as team', () => {
  const rows = [
    { id: 'a', ...personal },
    { id: 'b', ...team },
    { id: 'c', ...legacy },
  ] as NuphosDashboard[]
  const { personal: mine, team: shared } = splitByVisibility(rows)

  assert.deepEqual(
    mine.map((d) => d.id),
    ['a'],
  )
  assert.deepEqual(
    shared.map((d) => d.id),
    ['b', 'c'],
  )
})
