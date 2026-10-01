import { Hono } from 'hono'

import { config } from '@/config'
import { getAwsOidcDiscovery, getAwsOidcJwks, isAwsOidcConfigured } from '@/lib/byos/aws-oidc'
import { AppError } from '@/lib/errors'
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
} from '@/lib/oauth/metadata'

// Public, unauthenticated OIDC issuer metadata. AWS STS fetches these to
// validate web-identity tokens minted for BYOS AssumeRoleWithWebIdentity, so
// they must stay reachable without any Nuphos auth.
export const wellKnownRoutes = new Hono()

// ── MCP OAuth discovery (RFC 9728 Protected Resource Metadata + RFC 8414
// Authorization Server Metadata). Public and unauthenticated so an MCP client
// can bootstrap the auth flow from the 401 challenge on /mcp. ──
wellKnownRoutes.get('/oauth-protected-resource', (c) => {
  c.header('Cache-Control', 'public, max-age=300')

  return c.json(buildProtectedResourceMetadata(config.auth.publicBaseUrl))
})
// Clients also probe the resource-suffixed variant (…/oauth-protected-resource/mcp).
wellKnownRoutes.get('/oauth-protected-resource/mcp', (c) => {
  c.header('Cache-Control', 'public, max-age=300')

  return c.json(buildProtectedResourceMetadata(config.auth.publicBaseUrl))
})
wellKnownRoutes.get('/oauth-authorization-server', (c) => {
  c.header('Cache-Control', 'public, max-age=300')

  return c.json(
    buildAuthorizationServerMetadata(config.auth.publicBaseUrl, config.auth.oauthAuthorizeBaseUrl),
  )
})

function requireOidcConfigured(): void {
  if (!isAwsOidcConfigured()) {
    throw new AppError(404, 'oidc_not_configured', 'OIDC issuer is not configured')
  }
}

wellKnownRoutes.get('/openid-configuration', (c) => {
  requireOidcConfigured()
  c.header('Cache-Control', 'public, max-age=300')

  return c.json(getAwsOidcDiscovery())
})

// Short max-age so a signing-key rotation propagates quickly; keep the old key
// reachable until all outstanding tokens (tokenTtlSec) have expired.
wellKnownRoutes.get('/jwks.json', (c) => {
  requireOidcConfigured()
  c.header('Cache-Control', 'public, max-age=300')

  return c.json(getAwsOidcJwks())
})
