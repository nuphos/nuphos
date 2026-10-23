import { Hono } from 'hono'
import { z } from 'zod'

import { githubReviewScope, assertGithubReviewRequest } from '@/lib/agent/github-review-scope'
import { findGithubInstallation } from '@/lib/byos/account'
import {
  GithubApiError,
  getGithubAppSlug,
  getInstallation,
  getInstallationToken,
  invalidateInstallationToken,
  listInstallationRepositories,
} from '@/lib/byos/github'
import { githubInstallStartUrl, signInstallFlowState } from '@/lib/byos/github-install-flow'
import { AppError } from '@/lib/errors'
import { getNuphosUserById } from '@/lib/identity'
import { parseObjectId } from '@/lib/objectid'
import { personalCredentialSubjectFor, personalGithubToken } from '@/lib/personal-credentials'
import { zv } from '@/lib/validate'
import { requireTeamRole, requireGithubInstallation } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { registerGithubRepoDataRoutes } from '@/routes/github-installations/repo-data'
import { handleGithubError, publicView } from '@/routes/github-installations/shared'

import type { TeamAuthVariables, GithubInstallationVariables } from '@/middleware/auth'

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
  const state = c.req.query('state')
  const url = githubInstallStartUrl(
    signInstallFlowState({
      t: c.get('teamId'),
      u: c.get('userId'),
      ...(state ? { s: state } : {}),
    }),
  )

  if (!slug || !url) {
    throw new AppError(
      503,
      'github_app_not_configured',
      'GitHub App is not configured (set GITHUB_APP_SLUG and NUPHOS_PUBLIC_BACKEND_URL)',
    )
  }

  return c.json({ url, appSlug: slug })
})

// The GitHub setup callback binds after verifying the installer; this only
// confirms the result to clients that finish the flow by calling it.
githubInstallationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const { installationId } = c.req.valid('json')
    const binding = await findGithubInstallation(
      parseObjectId(c.get('teamId'), 'teamId'),
      installationId,
    )

    if (!binding) {
      throw new AppError(
        403,
        'github_installation_not_verified',
        'GitHub did not confirm that you can access this installation. Install or configure the GitHub App from Nuphos again.',
      )
    }

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
    // The turn acts as its member (the sender, or the session owner for
    // automated work) when they connected a Personal Credential, unless the
    // agent asks for the team identity. A repository-scoped conversation keeps
    // its narrower App token.
    const repositoryId = c.get('githubRepositoryId')
    const subject = await personalCredentialSubjectFor(
      'github',
      c.req.header('Authorization'),
      c.req.query('identity'),
    )
    const personal =
      subject && !repositoryId ? await personalGithubToken(subject, installationId) : null
    const { token, expiresAt } =
      personal ?? (await getInstallationToken(installationId, repositoryId))

    // Conversation auth sets userId to the current actor, not the runtime owner.
    const actor = await getNuphosUserById(c.get('userId'))

    if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())

    return c.json({
      token,
      expiresAt: expiresAt?.toISOString() ?? null,
      commitCoAuthor: actor ? { name: actor.name, email: actor.email } : null,
      installationId,
      accountLogin: c.get('githubAccountLogin'),
      actor: personal ? { kind: 'personal', login: personal.login } : { kind: 'team' },
    })
  } catch (e) {
    handleGithubError(e, 'Failed to mint installation token')
  }
})

registerGithubRepoDataRoutes(installationScoped)

githubInstallationsRoutes.route('/:installationId', installationScoped)
