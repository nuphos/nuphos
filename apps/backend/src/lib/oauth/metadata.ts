// OAuth 2.1 discovery metadata for the Nuphos MCP server.
//
// MCP clients (Claude Code, Codex) bootstrap auth by fetching these documents:
//   1. Protected Resource Metadata (RFC 9728) — pointed to by the 401
//      `WWW-Authenticate` challenge on the MCP endpoint; tells the client which
//      authorization server(s) protect this resource.
//   2. Authorization Server Metadata (RFC 8414) — tells the client where to
//      register, authorize, and exchange tokens, and that PKCE (S256) is required.
//
// Pure functions of the public base URL so they can be unit-tested without env.

export const MCP_SCOPE = 'mcp'

// The canonical resource identifier is the MCP endpoint URL. Access tokens are
// audience-bound to this exact string (RFC 8707).
export function mcpResourceUrl(baseUrl: string): string {
  return `${baseUrl}/mcp`
}

export function buildProtectedResourceMetadata(baseUrl: string): unknown {
  return {
    resource: mcpResourceUrl(baseUrl),
    authorization_servers: [baseUrl],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
  }
}

// `authorizeBaseUrl` lets the browser-facing authorize endpoint live on the
// root domain (nuphos.ai proxies /oauth/authorize* to the API, the same way it
// proxies /.well-known for the OIDC issuer) so the consent page shares the
// site's first-party login context and the user sees the brand domain in the
// URL bar. Machine-to-machine endpoints (token, register) stay on the API host.
export function buildAuthorizationServerMetadata(
  baseUrl: string,
  authorizeBaseUrl?: string,
): unknown {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${authorizeBaseUrl || baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Public clients (native apps) authenticate with PKCE, not a client secret.
    token_endpoint_auth_methods_supported: ['none'],
    // S256 only — plain PKCE is disallowed by OAuth 2.1.
    code_challenge_methods_supported: ['S256'],
  }
}
