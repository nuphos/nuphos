import { MCP_SCOPE } from '@/lib/oauth/metadata'
import { registerClient } from '@/lib/oauth/store'
import { isAllowedRedirectUri } from '@/routes/oauth/shared'

import type { Hono } from 'hono'

// ─── Dynamic Client Registration (RFC 7591) ─────────────────────────────────

export function registerOauthRegisterRoute(oauthRoutes: Hono) {
  oauthRoutes.post('/register', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      redirect_uris?: unknown
      client_name?: unknown
      scope?: unknown
    } | null

    const redirectUris = Array.isArray(body?.redirect_uris)
      ? body!.redirect_uris.filter((u): u is string => typeof u === 'string' && u.length > 0)
      : []

    if (redirectUris.length === 0 || redirectUris.some((u) => !isAllowedRedirectUri(u))) {
      return c.json(
        {
          error: 'invalid_redirect_uri',
          error_description: 'redirect_uris must be HTTPS or loopback HTTP URLs',
        },
        400,
      )
    }

    // Shown on the consent page: keep it short and printable. Counted in code
    // points so the cap never splits a surrogate pair.
    const clientName =
      typeof body?.client_name === 'string'
        ? Array.from(body.client_name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
            .slice(0, 100)
            .join('') || null
        : null
    const client = await registerClient({ clientName, redirectUris, scope: MCP_SCOPE })

    // RFC 7591 registration response. No secret: public client using PKCE.
    return c.json(
      {
        client_id: client._id,
        client_name: client.clientName ?? undefined,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: client.scope,
      },
      201,
    )
  })
}
