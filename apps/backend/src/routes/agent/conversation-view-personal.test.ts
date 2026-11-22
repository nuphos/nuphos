import { expect, test } from 'bun:test'

import { serializeConversationForViewer } from './conversation-view'

import type { NuphosUser } from '@/lib/identity'

const A = 'a'.repeat(24)
const B = 'b'.repeat(24)
const conversation = {
  sessionId: 's1',
  userId: 'owner',
  credentialAccess: { personalCredentialIds: ['github'], personalConnectionIds: [A, B] },
}
const view = (id: string) =>
  serializeConversationForViewer(
    conversation,
    { id } as NuphosUser,
    new Map(),
    null,
    null,
  ) as unknown as { credentialAccess: Record<string, unknown> }

test('the owner reads the connection ids of the accounts a conversation allows', () => {
  expect(view('owner').credentialAccess.personalConnectionIds).toEqual([A, B])
})

test('anyone else reads only how many accounts are allowed, never an id', () => {
  const access = view('teammate').credentialAccess

  expect(access.personalAccountCount).toBe(2)
  expect(access.personalCredentialIds).toEqual(['github'])
  expect(JSON.stringify(access)).not.toContain(A)
  expect('personalConnectionIds' in access).toBe(false)
})

test('a conversation with no connection selection is left as it is', () => {
  const plain = { sessionId: 's2', userId: 'owner', credentialAccess: { awsRoleIds: [] } }
  const out = serializeConversationForViewer(
    plain,
    { id: 'teammate' } as NuphosUser,
    new Map(),
    null,
    null,
  ) as unknown as { credentialAccess: Record<string, unknown> }

  expect(out.credentialAccess).toEqual({ awsRoleIds: [] })
})
