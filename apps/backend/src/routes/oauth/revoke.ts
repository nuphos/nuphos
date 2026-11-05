import { verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { revokeToken } from '@/lib/internal-token/revocation'

import type { Hono } from 'hono'

/**
 * RFC 7009 token revocation for conversation tokens. Whoever holds a token may
 * revoke it, and every token exchanged from it goes too. As the RFC requires,
 * an unknown or already invalid token is not an error.
 */
export function registerOauthRevokeRoute(oauthRoutes: Hono) {
  oauthRoutes.post('/revoke', async (c) => {
    c.header('Cache-Control', 'no-store')
    const form = await c.req.parseBody()
    const token = typeof form.token === 'string' ? form.token : ''

    if (!token) {
      return c.json({ error: 'invalid_request', error_description: 'Missing token' }, 400)
    }
    const claims = verifyPreviewMcpToken(token)

    if (claims?.jti) await revokeToken(claims.jti, claims.exp, 'holder')

    return c.body(null, 200)
  })
}
