import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { githubReviewScope, assertGithubReviewRequest } from '@/lib/agent/github-review-scope'
import { findGithubInstallation } from '@/lib/byos/account'
import {
  GithubApiError,
  buildInstallUrl,
  getGithubAppSlug,
  getInstallation,
  getInstallationToken,
  invalidateInstallationToken,
  isGithubAppConfigured,
  listInstallationRepositories,
} from '@/lib/byos/github'
import { AppError } from '@/lib/errors'
import { getNuphosUserById } from '@/lib/identity'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole, requireGithubInstallation } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { registerGithubRepoDataRoutes } from '@/routes/github-installations/repo-data'
import { handleGithubError, publicView } from '@/routes/github-installations/shared'

import type { TeamAuthVariables, GithubInstallationVariables } from '@/middleware/auth'
import type { GithubInstallationBinding } from '@/models'

export { publicView } from '@/routes/github-installations/shared'

export const githubInstallationsRoutes = new Hono<{
  Variables: TeamAuthVariables & { githubRepositoryId?: number }
}>()

githubInstallationsRoutes.use('*', async (c, next) => {
  const agent = (
    c as unknown as { get(key: 'conversationAgent'): { sessionId: string } | undefined }
  ).get('conversationAgent')
  const scope = await githubReviewScope(agent?.sessionId, c.get('teamId'))

  if (scope) {
    assertGithubReviewRequest(scope, c.req.method, c.req.path)
    c.set('githubRepositoryId', scope.repositoryId)
  }
  await next()
})

const bindSchema = z.object({
  installationId: z.number().int().positive(),
})

githubInstallationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { githubInstallations: 1 } },
  )

  return c.json({
    installations: (doc?.githubInstallations ?? []).map(publicView),
  })
})

githubInstallationsRoutes.get('/install-url', requireTeamRole('ADMINISTRATOR'), (c) => {
  const slug = getGithubAppSlug()

  if (!slug) {
    throw new AppError(
      503,
      'github_app_not_configured',
      'GitHub App slug is not configured (set GITHUB_APP_SLUG)',
    )
  }
  const state = c.req.query('state') ?? undefined
  const url = buildInstallUrl(state)

  if (!url) {
    throw new AppError(503, 'github_app_not_configured', 'Failed to build install URL')
  }

  return c.json({ url, appSlug: slug })
})

githubInstallationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    if (!isGithubAppConfigured()) {
      throw new AppError(
        503,
        'github_app_not_configured',
        'GitHub App is not configured on the server',
      )
    }

    const { installationId } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    const existing = await findGithubInstallation(teamId, installationId)

    if (existing) {
      throw new AppError(
        409,
        'installation_already_bound',
        `GitHub installation ${String(installationId)} is already bound`,
      )
    }

    let info

    try {
      info = await getInstallation(installationId)
    } catch (e) {
      handleGithubError(e, 'Failed to verify GitHub installation')
    }

    const id = new ObjectId()
    const createdAt = new Date()
    const binding: GithubInstallationBinding = {
      id,
      installationId,
      accountLogin: info.account.login,
      accountType: info.account.type,
      accountId: info.account.id,
      targetType: info.repositorySelection,
      createdAt,
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { githubInstallations: binding },
        $set: { updatedAt: createdAt },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          cloudflareAccounts: [],
          linodeAccounts: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json(publicView(binding), 201)
  },
)

const installationScoped = new Hono<{ Variables: GithubInstallationVariables }>()

installationScoped.use('*', requireGithubInstallation())

installationScoped.get('/', async (c) => {
  const installationId = c.get('githubInstallationId')
  const accountLogin = c.get('githubAccountLogin')
  const accountType = c.get('githubAccountType')
  let live

  try {
    live = await getInstallation(installationId)
  } catch (e) {
    if (e instanceof GithubApiError && e.status === 404) {
      return c.json({
        installationId,
        accountLogin,
        accountType,
        suspended: true,
        permissions: {},
      })
    }
    handleGithubError(e, 'Failed to fetch installation')
  }

  return c.json({
    installationId,
    accountLogin,
    accountType,
    targetType: live.repositorySelection,
    suspended: live.suspendedAt !== null,
    permissions: live.permissions,
    events: live.events,
  })
})

installationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const installationId = c.get('githubInstallationId')

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { githubInstallations: { installationId } },
      $set: { updatedAt: new Date() },
    },
  )
  invalidateInstallationToken(installationId)

  return c.body(null, 204)
})

installationScoped.get('/repositories', async (c) => {
  const installationId = c.get('githubInstallationId')

  try {
    const repos = await listInstallationRepositories(installationId)

    return c.json({ repositories: repos })
  } catch (e) {
    handleGithubError(e, 'Failed to list repositories')
  }
})

installationScoped.get('/token', requireTeamRole('ADMINISTRATOR', 'EDITOR'), async (c) => {
  const installationId = c.get('githubInstallationId')

  try {
    const { token, expiresAt } = await getInstallationToken(
      installationId,
      c.get('githubRepositoryId'),
    )

    // Conversation auth sets userId to the current actor, not the runtime owner.
    const actor = await getNuphosUserById(c.get('userId'))

    c.header('X-Credentials-Expires-At', expiresAt.toISOString())

    return c.json({
      token,
      expiresAt: expiresAt.toISOString(),
      commitCoAuthor: actor ? { name: actor.name, email: actor.email } : null,
      installationId,
      accountLogin: c.get('githubAccountLogin'),
    })
  } catch (e) {
    handleGithubError(e, 'Failed to mint installation token')
  }
})

registerGithubRepoDataRoutes(installationScoped)

githubInstallationsRoutes.route('/:installationId', installationScoped)
