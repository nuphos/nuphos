import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computerOwner, ownerName } from './computerOwner.ts'

import type { AgentDevice } from '../../api/device-types.ts'
import type { TeamMember } from '../../types/team.ts'

const device = (fields: Partial<AgentDevice>) =>
  fields as Pick<AgentDevice, 'access' | 'ownerUserId'>

const member = (id: string, fields: Partial<TeamMember>): TeamMember => ({
  id,
  name: '',
  email: '',
  username: '',
  role: 'EDITOR',
  joinedAt: '2026-01-01T00:00:00Z',
  ...fields,
})

test("a teammate's computer names its owner; the viewer's own and an older list do not", () => {
  assert.equal(computerOwner(device({ access: 'use', ownerUserId: 'alice' })), 'alice')
  assert.equal(computerOwner(device({ access: 'manage', ownerUserId: 'alice' })), 'alice')
  assert.equal(computerOwner(device({ access: 'owner', ownerUserId: 'viewer' })), null)
  assert.equal(computerOwner(device({})), null)
})

test('the owner reads as their email, else their name, and unknown until members load', () => {
  assert.equal(
    ownerName('alice', [member('alice', { email: 'alice@demo.test', name: 'Alice' })]),
    'alice@demo.test',
  )
  assert.equal(ownerName('alice', [member('alice', { name: 'Alice' })]), 'Alice')
  assert.equal(ownerName('alice', [member('bob', { email: 'bob@demo.test' })]), null)
  assert.equal(ownerName('alice', null), null)
})
