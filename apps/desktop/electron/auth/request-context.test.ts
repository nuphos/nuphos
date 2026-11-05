import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('an unreadable sign-in sends a request without a token instead of failing it', async () => {
  mock.module('./config.ts', {
    namedExports: { readConfig: () => Promise.reject(new Error('denied')) },
  })
  const { authSession } = await import('../auth-session.ts')
  const { requestContext } = await import('./request-context.ts')

  const ctx = await requestContext()

  assert.equal(ctx.token, null)
  assert.equal(ctx.api, authSession.context().api)
})
