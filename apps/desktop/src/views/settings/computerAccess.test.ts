import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accessChanged,
  ACCESS_ROLE_LABEL,
  initialRoles,
  roleOptions,
  shareRequest,
  shownRole,
} from './computerAccess.ts'

test('managers read as manage, the rest of the use list as use', () => {
  const roles = initialRoles({ userIds: ['mate', 'lead'] }, ['lead'])

  assert.deepEqual(
    [...roles],
    [
      ['mate', 'use'],
      ['lead', 'manage'],
    ],
  )
  assert.deepEqual([...initialRoles({ userIds: [] })], [])
})

test('with everyone allowed, no one reads as having no access', () => {
  assert.equal(shownRole(undefined, true), 'use')
  assert.equal(shownRole('none', true), 'use')
  assert.equal(shownRole(undefined, false), 'none')
  assert.equal(shownRole('manage', false), 'manage')
})

test('only the owner may pick manage; no access goes once everyone may use it', () => {
  assert.deepEqual(roleOptions(false, true), ['none', 'use', 'manage'])
  assert.deepEqual(roleOptions(true, true), ['use', 'manage'])
  assert.deepEqual(roleOptions(false, false), ['none', 'use'])
  assert.deepEqual(ACCESS_ROLE_LABEL, { none: 'No access', use: 'Use', manage: 'Manage' })
})

test('the owner saves managers, who stay in the use list', () => {
  const roles = new Map([
    ['mate', 'use'],
    ['lead', 'manage'],
    ['gone', 'none'],
  ] as const)

  assert.deepEqual(shareRequest(roles, false, true), {
    level: 'full',
    everyone: false,
    userIds: ['mate', 'lead'],
    managerIds: ['lead'],
  })
})

test("a manager's save leaves managers alone, and no one chosen turns sharing off", () => {
  const roles = new Map([['mate', 'use']] as const)

  assert.deepEqual(shareRequest(roles, false, false), {
    level: 'full',
    everyone: false,
    userIds: ['mate'],
  })
  assert.deepEqual(shareRequest(new Map(), false, true), {
    level: 'off',
    everyone: false,
    userIds: [],
    managerIds: [],
  })
  assert.equal(shareRequest(new Map(), true, true).level, 'full')
})

test('a save refused because access changed meanwhile is told apart from other failures', () => {
  const refused = (code: string) =>
    new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: 'refused', code })}`)

  assert.equal(accessChanged(refused('access_changed')), true)
  assert.equal(accessChanged(refused('owner_only')), false)
  assert.equal(accessChanged(new Error('offline')), false)
})
