import { expect, test } from 'bun:test'

import { canEditAccess, canUseBinding } from './access'
import { connectorSharing } from './connector-sharing'
import { initialBindingAccess } from './initial-access'

const access = (list: string[], owner = 'owner') => ({
  memberAllowList: list,
  ownerUserId: owner,
  updatedAt: new Date(),
  updatedBy: owner,
})

test('a shared binding is managed only by admins', () => {
  expect(canEditAccess(access(['*']), 'owner', 'EDITOR')).toBe(false)
  expect(canEditAccess(access(['*']), 'admin', 'ADMINISTRATOR')).toBe(true)
  expect(canEditAccess(access(['owner']), 'owner', 'EDITOR')).toBe(true)
  expect(canEditAccess(access(['owner']), 'admin', 'ADMINISTRATOR')).toBe(false)
})
test('viewers cannot use a shared binding', () => {
  expect(canUseBinding(access(['*']), 'viewer', 'VIEWER')).toBe(false)
  expect(canUseBinding(access(['*']), 'editor', 'EDITOR')).toBe(true)
})
test('new connections stay private even with an old team-wide default', () => {
  expect(
    initialBindingAccess({ userId: 'owner', team: { bindingShareDefault: 'team' } })
      .memberAllowList,
  ).toEqual(['owner'])
})
test('inventory distinguishes own and shared without exposing someone else’s private connection', () => {
  const doc = {
    linodeAccounts: [
      { id: 'mine', access: access(['owner']) },
      { id: 'shared', access: access(['*']) },
      { id: 'other', access: access(['other'], 'other') },
    ],
  }

  expect(connectorSharing(doc, 'owner', 'EDITOR')).toEqual({
    'linode:mine': { owned: true, shared: false },
    'linode:shared': { owned: true, shared: true },
  })
  expect(connectorSharing(doc, 'viewer', 'VIEWER')).toEqual({})
})
