import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useIdentity } from '@/lib/test/doubles/identity'

import type * as identityActual from '@/lib/identity'

const ADMIN = {
  id: '507f1f77bcf86cd799439011',
  email: 'admin@example.com',
  name: 'Admin',
  username: 'admin',
  avatarURL: '',
  language: 'en-US',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const NON_ADMIN = { ...ADMIN, id: '507f191e810c19729de860ea', email: 'user@example.com' }
const TEAM = {
  id: '69e989027ab63e8d6a0ffcb6',
  name: 'Nuphos Admins',
  avatarUrl: '',
  ownerID: ADMIN.id,
  contactEmails: [ADMIN.email],
  createdAt: '2026-01-01T00:00:00.000Z',
}

useIdentity({
  authenticateToken: (async (token: string) => {
    const user =
      token === 'valid-admin-token' ? ADMIN : token === 'valid-non-admin-token' ? NON_ADMIN : null

    return user ? { user, cacheHit: false, provider: 'nuphos' as const } : null
  }) as typeof identityActual.authenticateToken,
  getTeamMembership: (async (userId: string) =>
    userId === ADMIN.id
      ? { role: 'ADMINISTRATOR' as const, team: TEAM }
      : null) as typeof identityActual.getTeamMembership,
})

const { adminRoutes } = await import('@/routes/admin')

function app() {
  const outer = new Hono()

  outer.onError(errorHandler)
  outer.route('/admin', adminRoutes)

  return outer
}

describe('GET /admin/session', () => {
  test('returns the authenticated admin identity', async () => {
    const response = await app().request('/admin/session', {
      headers: { Cookie: 'nuphos_token=valid-admin-token' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ userId: ADMIN.id })
  })

  test('rejects a missing or invalid session', async () => {
    const response = await app().request('/admin/session')

    expect(response.status).toBe(401)
  })

  test('rejects an authenticated user outside the admin team', async () => {
    const response = await app().request('/admin/session', {
      headers: { Cookie: 'nuphos_token=valid-non-admin-token' },
    })

    expect(response.status).toBe(403)
  })
})
