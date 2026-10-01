import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { trimTrailingSlash } from 'hono/trailing-slash'

import openApiDocument from '@/generated/api/openapi.json'
import { errorHandler, notFoundHandler } from '@/lib/errors'
import { analyticsMiddleware } from '@/middleware/analytics'
import { responseCompression } from '@/middleware/compression'
import { requestLog } from '@/middleware/request-log'
import { otelHono } from '@/otel'
import { adminRoutes } from '@/routes/admin'
import { agent } from '@/routes/agent'
import { agentJournal } from '@/routes/agent-journal'
import { agentSessions } from '@/routes/agent-sessions'
import { agentTriggersRoutes } from '@/routes/agent-triggers'
import { asanaAppRoutes } from '@/routes/asana-app'
import { auth } from '@/routes/auth'
import { claudeCodeRuntimeSkills } from '@/routes/claude-code-runtime-skills'
import { cloudflareAppRoutes } from '@/routes/cloudflare-app'
import { desktopRoutes } from '@/routes/desktop'
import { discordRoutes } from '@/routes/discord'
import { discordAppRoutes } from '@/routes/discord-app'
import { downloadHandoffRateLimitRoutes } from '@/routes/download-handoff-rate-limit'
import { githubAppRoutes } from '@/routes/github-app'
import { gitlabAppRoutes } from '@/routes/gitlab-app'
import { health } from '@/routes/health'
import { invitationsRoutes } from '@/routes/invitations'
import { inviteLandingRoutes } from '@/routes/invite-landing'
import { jiraAppRoutes } from '@/routes/jira-app'
import { larkRoutes } from '@/routes/lark'
import { linearAppRoutes } from '@/routes/linear-app'
import { mcp } from '@/routes/mcp'
import { oauthRoutes } from '@/routes/oauth'
import { pushRoutes } from '@/routes/push-devices'
import { posthogAppRoutes } from '@/routes/posthog-app'
import { sentryAppRoutes } from '@/routes/sentry-app'
import { slackRoutes } from '@/routes/slack'
import { slackAppRoutes } from '@/routes/slack-app'
import { teamsRoutes } from '@/routes/teams'
import { vantaAppRoutes } from '@/routes/vanta-app'
import { webhooksRoutes } from '@/routes/webhooks'
import { wellKnownRoutes } from '@/routes/well-known'

export { websocket } from 'hono/bun'

export const app = new Hono()

app.use(trimTrailingSlash())
// Outermost on purpose: compress() drops Content-Length, and otelHono reads
// that header in its finally block for http.response.body.size. Registered
// first, compression runs after otel has recorded the uncompressed size, so
// the metric keeps its meaning and only the wire shrinks.
app.use('*', responseCompression())
app.use('*', requestId())
// otelHono must come right after requestId() so it can stamp the request_id
// on the server span; and before any route handlers / cors so the span
// covers the whole pipeline.
app.use('*', otelHono())
app.use('*', requestLog())
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'X-Atlas-Locale',
      'X-Atlas-Url',
      'X-Atlas-Client',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
)
// Capture every request as a PostHog `api_request` event. After cors so
// preflights are visible to the skip filter; reads userId/teamId post-next.
app.use('*', analyticsMiddleware)

app.get('/openapi.json', (c) => c.json(openApiDocument))
app.route('/health', health)
// Public OIDC issuer metadata for AWS BYOS web-identity federation. AWS STS
// fetches these unauthenticated, so they live outside the auth'd route tree.
app.route('/.well-known', wellKnownRoutes)
app.route('/auth', auth)
// Server-to-server abuse fence for nuphos.ai's public email handoff. The route
// authenticates its caller and fails closed when shared Redis is unavailable.
app.route('/internal/download-handoff-rate-limit', downloadHandoffRateLimitRoutes)
app.route('/internal/claude-code-runtime-skills', claudeCodeRuntimeSkills)
app.route('/desktop', desktopRoutes)
app.route('/push', pushRoutes)
app.route('/teams', teamsRoutes)
app.route('/invitations', invitationsRoutes)
app.route('/agent/triggers', agentTriggersRoutes)
app.route('/agent', agent)

app.route('/agent-journal', agentJournal)
app.route('/webhooks', webhooksRoutes)
app.route('/agent-sessions', agentSessions)
// MCP (Model Context Protocol) server — lets external MCP clients (Claude Code,
// Codex, …) talk to the Nuphos Agent. See routes/mcp.ts.
app.route('/mcp', mcp)
// OAuth 2.1 authorization server backing the MCP flow (DCR + PKCE authorize +
// token). Unauthenticated by design — this IS the auth surface. See routes/oauth.ts.
app.route('/oauth', oauthRoutes)
// Team-invitation email landing page (deep-links into the app, download
// fallback). Unauthenticated by design — reached from an email click.
app.route('/invite', inviteLandingRoutes)
app.route('/github-app', githubAppRoutes)
app.route('/gitlab-app', gitlabAppRoutes)
app.route('/cloudflare-app', cloudflareAppRoutes)
app.route('/vanta-app', vantaAppRoutes)
app.route('/linear-app', linearAppRoutes)
app.route('/jira-app', jiraAppRoutes)
app.route('/asana-app', asanaAppRoutes)
app.route('/posthog-app', posthogAppRoutes)
app.route('/sentry-app', sentryAppRoutes)
app.route('/slack-app', slackAppRoutes)
app.route('/discord-app', discordAppRoutes)
app.route('/discord', discordRoutes)
app.route('/slack', slackRoutes)
app.route('/lark', larkRoutes)
app.route('/admin', adminRoutes)

app.notFound(notFoundHandler)
app.onError(errorHandler)
