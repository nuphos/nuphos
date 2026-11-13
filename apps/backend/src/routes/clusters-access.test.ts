import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { usableClusterBindings } from './clusters'

import type { TeamByosBindings } from '@/models'

const privateRole = {
  id: new ObjectId(),
  roleArn: 'arn:aws:iam::123456789012:role/private',
  access: {
    memberAllowList: ['owner'],
    ownerUserId: 'owner',
    updatedAt: new Date(),
    updatedBy: 'owner',
  },
}
const sharedRole = {
  id: new ObjectId(),
  roleArn: 'arn:aws:iam::123456789012:role/shared',
  access: {
    memberAllowList: ['owner', 'u2'],
    ownerUserId: 'owner',
    updatedAt: new Date(),
    updatedBy: 'owner',
  },
}
const doc = {
  _id: new ObjectId(),
  awsRoles: [privateRole, sharedRole],
} as unknown as TeamByosBindings
const rolesFor = (userId: string, teamRole: string) =>
  usableClusterBindings({ var: { userId, teamRole } } as never, doc)?.awsRoles.map((b) => b.roleArn)

test("a member off a private binding's list does not see its clusters", () => {
  expect(rolesFor('u3', 'EDITOR')).toEqual([])
})

test('the owner sees their private binding', () => {
  expect(rolesFor('owner', 'EDITOR')).toEqual([privateRole.roleArn, sharedRole.roleArn])
})

test("an admin sees shared bindings but not another member's private one", () => {
  expect(rolesFor('admin', 'ADMINISTRATOR')).toEqual([sharedRole.roleArn])
})
