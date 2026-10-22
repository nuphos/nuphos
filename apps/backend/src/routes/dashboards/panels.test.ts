import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'

import type { AgentCredentialAccess } from '@/lib/agent/db'
import type { AgentRef } from '@/lib/agents/identity'
import type { AgentCredentialOptions } from '@/routes/agent/types'

const PROD = '64b5f1c2e4b0a1d2c3e4f501'
const STAGING = '64b5f1c2e4b0a1d2c3e4f502'

// Every provider list the resolver reads; only AWS matters here.
const options = new Proxy({ awsRoles: [{ roleId: PROD }, { roleId: STAGING }] } as object, {
  get: (target, key) => (target as Record<PropertyKey, unknown>)[key] ?? [],
}) as AgentCredentialOptions

const held = {
  awsRoleIds: [PROD],
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedBy: 'owner',
} as AgentCredentialAccess

useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve(options) })
useAgentSessionsShared({ getAgentCredentialAccess: () => Promise.resolve(held) as never })

const { panelCredentialAccess } = await import('./panels')

const teamId = new ObjectId()

function caller(conversationAgent?: AgentRef) {
  const vars: Record<string, unknown> = { userId: 'member', conversationAgent }

  return { get: (key: string) => vars[key] } as { get(key: 'userId'): string }
}

const conversation = { sessionId: 's1', userId: 'member' } as AgentRef

describe('panelCredentialAccess', () => {
  test('a member saving without a selection leaves the panel unpinned', async () => {
    expect(await panelCredentialAccess(caller(), teamId, undefined)).toBeUndefined()
  })

  test('a member selection is checked against their own allow lists', async () => {
    const access = await panelCredentialAccess(caller(), teamId, {
      awsRoleIds: [PROD, STAGING],
    })

    expect(access?.awsRoleIds).toEqual([PROD, STAGING])
  })

  test('a conversation saving without a selection pins the panel to what it holds', async () => {
    const access = await panelCredentialAccess(caller(conversation), teamId, undefined)

    expect(access?.awsRoleIds).toEqual([PROD])
  })

  test('a conversation cannot hand a panel credentials it was not given', async () => {
    const requested = await panelCredentialAccess(caller(conversation), teamId, {
      awsRoleIds: [PROD, STAGING],
    })
    const existing = await panelCredentialAccess(caller(conversation), teamId, undefined, {
      ...held,
      awsRoleIds: [STAGING],
    })

    expect(requested?.awsRoleIds).toEqual([PROD])
    expect(existing?.awsRoleIds).toEqual([])
  })
})
