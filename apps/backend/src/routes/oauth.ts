// OAuth 2.1 Authorization Server for the Nuphos MCP server.
//
// Implements exactly the subset MCP clients (Claude Code, Codex) need to run
// their native "open a browser, authorize, done" flow against a remote MCP
// server:
//   POST /oauth/register   — Dynamic Client Registration (RFC 7591). Clients
//                            self-register a client_id + redirect_uris; no
//                            client secret (public client, PKCE-protected).
//   GET  /oauth/authorize  — Consent + login page. The user proves identity via
//                            email OTP (reusing the existing sign-in path), then
//                            we mint a PKCE-bound authorization code and redirect
//                            back to the client's loopback redirect_uri.
//   POST /oauth/authorize/email — Sends the email OTP (called by the page).
//   POST /oauth/authorize  — Completes: verifies OTP, issues the code, redirects.
//   POST /oauth/token      — authorization_code (+ PKCE) and refresh_token grants.
//
// User authentication on the consent page is email OTP only for the MVP; Google
// can be added as a second button later without changing the OAuth surface.

import { Hono } from 'hono'

import { registerOauthAuthorizeRoutes } from '@/routes/oauth/authorize'
import { registerOauthRegisterRoute } from '@/routes/oauth/register'
import { registerOauthTokenRoute } from '@/routes/oauth/token'

export const oauthRoutes = new Hono()

registerOauthRegisterRoute(oauthRoutes)
registerOauthAuthorizeRoutes(oauthRoutes)
registerOauthTokenRoute(oauthRoutes)
