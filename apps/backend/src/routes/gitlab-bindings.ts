import crypto from 'node:crypto'

import { Hono } from 'hono'
import { z } from 'zod'

import {
  buildAuthorizeUrl,
  getSetupRedirect,
  isGitlabConfigured,
  listNamespaces,
  normalizeHostUrl,
  resolveOAuthClient,
} from '@/lib/byos/gitlab'
import { encryptGitlabSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole, requireGitlabBinding } from '@/middleware/auth'
import { teamByosBindings, gitlabPendingOAuth } from '@/models'
import { registerGitlabBindingScopedRoutes } from '@/routes/gitlab-bindings/binding-scoped'
import { handleGitlabError, publicView } from '@/routes/gitlab-bindings/shared'

import type { TeamAuthVariables, GitlabBindingVariables } from '@/middleware/auth'

export { publicView } from '@/routes/gitlab-bindings/shared'

export const gitlabBindingsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const ALLOWED_SCOPES = [
  'read_api',
  'read_user',
  'read_repository',
  'write_repository',
  'api',
] as const
const DEFAULT_SCOPES: (typeof ALLOWED_SCOPES)[number][] = [
  'read_api',
  'read_user',
  'read_repository',
]
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

function resolveGitlabScopeParam(selected?: string[], legacyScope?: string): string {
  const base =
    selected && selected.length > 0
      ? selected
      : legacyScope
        ? legacyScope.split(/\s+/)
        : DEFAULT_SCOPES
  const allowed = new Set<string>(ALLOWED_SCOPES)
  const set = new Set(base.map((s) => s.trim()).filter((s) => allowed.has(s)))

  if (set.size === 0) {
    for (const scope of DEFAULT_SCOPES) set.add(scope)
  }
  if (set.has('api')) set.delete('read_api')

  return Array.from(set).join(' ')
}

gitlabBindingsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gitlabAccounts: 1 } },
  )

  return c.json({
    bindings: (doc?.gitlabAccounts ?? []).map(publicView),
  })
})

const startOAuthSchema = z
  .object({
    hostUrl: z.string().min(1).default('https://gitlab.com'),
    // Optional per-binding OAuth client override. Required for self-hosted
    // GitLab where the operator has not configured server defaults.
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    scopes: z.array(z.enum(ALLOWED_SCOPES)).max(16).optional(),
    // Deprecated compatibility path for older desktop builds.
    scope: z.string().min(1).optional(),
  })
  .refine((data) => (data.clientId == null) === (data.clientSecret == null), {
    // resolveOAuthClient only accepts the override when *both* are present;
    // without this guard, passing a single field would silently fall back to
    // the server-default app instead of failing.
    message: 'clientId and clientSecret must both be provided or both omitted',
    path: ['clientSecret'],
  })

gitlabBindingsRoutes.post(
  '/start-oauth',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', startOAuthSchema),
  async (c) => {
    if (!isGitlabConfigured()) {
      throw new AppError(
        503,
        'gitlab_oauth_not_configured',
        'GitLab OAuth is not configured on the server (set GITLAB_OAUTH_SETUP_REDIRECT)',
      )
    }
    const { hostUrl, clientId, clientSecret, scopes, scope } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const requesterUserId = c.get('userId')

    let host: string

    try {
      host = normalizeHostUrl(hostUrl)
    } catch (e) {
      handleGitlabError(e, 'Invalid GitLab host URL')
    }

    let resolved

    try {
      resolved = resolveOAuthClient(
        host,
        clientId && clientSecret ? { clientId, clientSecret } : null,
      )
    } catch (e) {
      handleGitlabError(e, 'Failed to resolve OAuth client')
    }

    const setupRedirect = getSetupRedirect()

    if (!setupRedirect) {
      throw new AppError(
        503,
        'gitlab_oauth_not_configured',
        'GITLAB_OAUTH_SETUP_REDIRECT is not configured',
      )
    }

    const state = crypto.randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

    await gitlabPendingOAuth().insertOne({
      _id: state,
      teamId,
      requesterUserId,
      hostUrl: host,
      clientId: resolved.clientId,
      // We only persist the secret if it was caller-supplied; for default
      // gitlab.com OAuth we re-read the server env at exchange time.
      encryptedClientSecret: resolved.isDefault ? null : encryptGitlabSecret(resolved.clientSecret),
      expiresAt,
    })

    const authorizeUrl = buildAuthorizeUrl({
      hostUrl: host,
      clientId: resolved.clientId,
      redirectUri: setupRedirect,
      state,
      scope: resolveGitlabScopeParam(scopes, scope),
    })

    return c.json({
      authorizeUrl,
      state,
      hostUrl: host,
      expiresAt: expiresAt.toISOString(),
    })
  },
)

gitlabBindingsRoutes.delete('/start-oauth/:state', requireTeamRole('ADMINISTRATOR'), async (c) => {
  // Allow the desktop to cancel a pending grant if the user closes the
  // dialog before authorising in the browser. Idempotent.
  const state = c.req.param('state')

  if (!state || !/^[a-f0-9]{1,128}$/i.test(state)) {
    throw new AppError(400, 'invalid_state', 'Invalid state token')
  }
  const teamId = parseObjectId(c.get('teamId'), 'teamId')

  await gitlabPendingOAuth().deleteOne({ _id: state, teamId })

  return c.body(null, 204)
})

const bindingScoped = new Hono<{ Variables: GitlabBindingVariables }>()

bindingScoped.use('*', requireGitlabBinding())

registerGitlabBindingScopedRoutes(bindingScoped)

// Flat view across every binding — one call for the sidebar to render all
// groups/personal namespaces, mirroring how GitHub installations flatten.
// Registered before the /:bindingId mount so the literal path wins.
gitlabBindingsRoutes.get('/namespaces', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gitlabAccounts: 1 } },
  )
  const bindings = doc?.gitlabAccounts ?? []
  const results = await Promise.all(
    bindings.map(async (b) => {
      const base = { bindingId: b.id.toHexString(), hostUrl: b.hostUrl, username: b.username }

      try {
        return { ...base, namespaces: await listNamespaces(teamId, b) }
      } catch {
        // A binding with a revoked/expired token shouldn't blank the whole
        // sidebar — return it empty and let the binding-scoped routes surface
        // the auth error when the user drills in.
        return { ...base, namespaces: [] }
      }
    }),
  )

  return c.json({ bindings: results })
})

gitlabBindingsRoutes.route('/:bindingId', bindingScoped)

// Re-exported so the public /gitlab-app/setup route (which is not team-scoped
// and can't reach gitlabBindingsRoutes' middleware) can ack the bind from a
// browser redirect.
export { OAUTH_PENDING_TTL_MS }
