import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { mintPreviewMcpToken, verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'

import { registerOauthRevokeRoute } from './revoke'

const revoked: { jti: string; exp: number; reason: string }[] = []

useTokenRevocation({
  revokeToken: async (jti, exp, reason) => {
    revoked.push({ jti, exp, reason })

    return 1
  },
})

const app = new Hono()

registerOauthRevokeRoute(app)

beforeEach(() => {
  revoked.length = 0
})

const revoke = (token?: string) =>
  app.request('/revoke', {
    method: 'POST',
    body: new URLSearchParams(token === undefined ? {} : { token }),
  })

test('the holder of a conversation token can revoke it', async () => {
  const token = await mintPreviewMcpToken({ userId: 'u', sessionId: 'conv-1', teamId: 'team-1' })
  const claims = verifyPreviewMcpToken(token)
  const res = await revoke(token)

  expect(res.status).toBe(200)
  expect(revoked).toEqual([{ jti: claims!.jti!, exp: claims!.exp, reason: 'holder' }])
})

test('an unknown token is not an error (RFC 7009), a missing one is', async () => {
  expect((await revoke('not-a-token')).status).toBe(200)
  expect(revoked).toEqual([])
  expect((await revoke()).status).toBe(400)
})
