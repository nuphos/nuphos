import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import {
  registerCloudflareAccountRoutes,
  registerCloudflareAdminRoutes,
} from '@/routes/cloudflare-accounts/account'

import { bindingAccessPrincipals } from './binding-access'
import { requireCloudflareMemberAccess } from './providers'

import type { AgentRef } from '@/lib/agents/identity'
import type { CloudflareAccountVariables } from '@/middleware/auth'

type Caller = {
  role?: 'ADMINISTRATOR' | 'EDITOR'
  userId: string
  conversationAgent?: AgentRef
}

function app(memberAllowList: string[] | undefined, caller: Caller) {
  const scoped = new Hono<{ Variables: CloudflareAccountVariables }>()

  scoped.use('*', async (c, next) => {
    c.set('teamRole', caller.role ?? 'EDITOR')
    c.set('userId', caller.userId)
    if (caller.conversationAgent) {
      ;(c as unknown as { set(key: string, value: AgentRef): void }).set(
        'conversationAgent',
        caller.conversationAgent,
      )
    }
    c.set('cloudflareAccountId', 'a'.repeat(32))
    c.set('cloudflareAccountName', 'Acme')
    c.set('cloudflareBinding', {
      oauth: {},
      ...(memberAllowList ? { access: { memberAllowList } } : {}),
    } as never)
    await next()
  })
  registerCloudflareAdminRoutes(scoped)
  scoped.use('*', requireCloudflareMemberAccess())
  registerCloudflareAccountRoutes(scoped)

  return scoped.onError(errorHandler)
}

const principals = (vars: Record<string, unknown>) =>
  bindingAccessPrincipals({ var: vars } as never)

describe('bindingAccessPrincipals', () => {
  test('is the caller alone for a member session', () => {
    expect(principals({ userId: 'u1' })).toEqual(['u1'])
  })

  test('adds the sender and the owner of a conversation token', () => {
    const conversationAgent = { userId: 'u1', sessionId: 's', conversationOwnerUserId: 'owner' }

    expect(principals({ userId: 'u1', conversationAgent })).toEqual(['u1', 'owner'])
  })
})

describe('Cloudflare binding member list', () => {
  test('a binding without a list stays open to the team', async () => {
    expect((await app(undefined, { userId: 'u2' }).request('/credentials')).status).toBe(200)
  })

  test('refuses an editor who is not on the list', async () => {
    const response = await app(['u1'], { userId: 'u2' }).request('/credentials')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'cloudflare_account_access_denied' },
    })
  })

  test('serves an editor on the list', async () => {
    expect((await app(['u1'], { userId: 'u1' }).request('/credentials')).status).toBe(200)
  })

  test('refuses a conversation whose owner is not on the list, even when the sender is', async () => {
    const caller = {
      userId: 'u1',
      conversationAgent: { userId: 'u1', sessionId: 's', conversationOwnerUserId: 'u2' },
    }

    expect((await app(['u1'], caller).request('/credentials')).status).toBe(403)
    expect((await app(['u1', 'u2'], caller).request('/credentials')).status).toBe(200)
  })

  test('lets an admin who is not on the list read the list', async () => {
    const response = await app(['u1'], { role: 'ADMINISTRATOR', userId: 'admin' }).request(
      '/access',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ memberAllowList: ['u1'] })
  })

  test("keeps the list itself from editors who don't own the binding", async () => {
    expect((await app(['u1', 'u2'], { userId: 'u2' }).request('/access')).status).toBe(403)
  })

  test('lets an admin off the list use a binding shared with specific people', async () => {
    const admin = { role: 'ADMINISTRATOR' as const, userId: 'admin' }

    expect((await app(['u1', 'u2'], admin).request('/credentials')).status).toBe(200)
  })

  test("refuses an admin another member's private binding", async () => {
    const admin = { role: 'ADMINISTRATOR' as const, userId: 'admin' }

    expect((await app(['u1'], admin).request('/credentials')).status).toBe(403)
  })

  test('gives a conversation token no admin exception', async () => {
    const caller = {
      role: 'ADMINISTRATOR' as const,
      userId: 'admin',
      conversationAgent: { userId: 'admin', sessionId: 's' },
    }

    expect((await app(['u1', 'u2'], caller).request('/credentials')).status).toBe(403)
  })
})
