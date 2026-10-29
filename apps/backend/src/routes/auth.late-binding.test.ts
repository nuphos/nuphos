import { expect, test } from 'bun:test'

// Load the router before the @/middleware/auth double is registered, the way an
// earlier suite in a shared test process can (it made avatars.test.ts flake).
const { auth } = await import('@/routes/auth')
const { useAuthMiddleware } = await import('@/lib/test/doubles/auth-middleware')

useAuthMiddleware({
  requireAuth: async (c) => c.json({ authenticatedBy: 'double' }),
})

test('the auth router uses an auth double registered after it loaded', async () => {
  const res = await auth.request('/me')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ authenticatedBy: 'double' })
})
