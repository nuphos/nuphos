import { z } from 'zod'

import {
  invalidateAccessToken,
  getAccessTokenWithExpiry,
  listMergeRequests,
  listNamespaces,
  listPipelines,
  listProjects,
} from '@/lib/byos/gitlab'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { handleGitlabError, publicView } from '@/routes/gitlab-bindings/shared'

import type { GitlabBindingVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const projectsQuerySchema = z.object({
  // Root namespace full path (first path segment), e.g. "my-group" or the
  // username for personal namespaces. Filters membership projects to that
  // top-level namespace.
  namespace: z.string().min(1).max(255).optional(),
})

const projectIdSchema = z.object({
  projectId: z.coerce.number().int().positive(),
})

const mrQuerySchema = z.object({
  state: z.enum(['opened', 'closed', 'merged', 'all']).default('opened'),
  per_page: z.coerce.number().int().min(1).max(100).default(30),
  page: z.coerce.number().int().min(1).default(1),
})

const pipelinesQuerySchema = z.object({
  per_page: z.coerce.number().int().min(1).max(100).default(30),
  page: z.coerce.number().int().min(1).default(1),
})

export function registerGitlabBindingScopedRoutes(
  bindingScoped: Hono<{ Variables: GitlabBindingVariables }>,
) {
  bindingScoped.get('/', (c) => {
    const binding = c.get('gitlabBinding')

    return c.json(publicView(binding))
  })

  bindingScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = c.get('gitlabBinding')

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $pull: { gitlabAccounts: { id: binding.id } },
        $set: { updatedAt: new Date() },
      },
    )
    invalidateAccessToken(teamId, binding.id)

    return c.body(null, 204)
  })

  // Agent credential handout, mirroring github-installations /token: the
  // sandbox exchanges its NUPHOS_TOKEN for the binding's short-lived (~2 h,
  // auto-refreshed) OAuth access token and talks to GitLab directly.
  bindingScoped.get('/token', requireTeamRole('ADMINISTRATOR', 'EDITOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = c.get('gitlabBinding')

    try {
      const { token, expiresAt } = await getAccessTokenWithExpiry(teamId, binding)

      if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
      // A reusable bearer token over GET must never be cached by intermediaries.
      c.header('Cache-Control', 'no-store, private')
      c.header('Pragma', 'no-cache')

      return c.json({
        token,
        expiresAt: expiresAt?.toISOString() ?? null,
        hostUrl: binding.hostUrl,
        username: binding.username,
        scope: binding.scope,
      })
    } catch (e) {
      handleGitlabError(e, 'Failed to obtain GitLab access token')
    }
  })

  bindingScoped.get('/namespaces', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = c.get('gitlabBinding')

    try {
      const namespaces = await listNamespaces(teamId, binding)

      return c.json({ namespaces })
    } catch (e) {
      handleGitlabError(e, 'Failed to list namespaces')
    }
  })

  bindingScoped.get('/projects', zv('query', projectsQuerySchema), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = c.get('gitlabBinding')
    const { namespace } = c.req.valid('query')

    try {
      const projects = await listProjects(teamId, binding, namespace)

      return c.json({ projects })
    } catch (e) {
      handleGitlabError(e, 'Failed to list projects')
    }
  })

  bindingScoped.get(
    '/projects/:projectId/merge-requests',
    zv('param', projectIdSchema),
    zv('query', mrQuerySchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const binding = c.get('gitlabBinding')
      const { projectId } = c.req.valid('param')
      const { state, per_page, page } = c.req.valid('query')

      try {
        const mergeRequests = await listMergeRequests(
          teamId,
          binding,
          projectId,
          state,
          per_page,
          page,
        )

        return c.json({ mergeRequests })
      } catch (e) {
        handleGitlabError(e, 'Failed to list merge requests')
      }
    },
  )

  bindingScoped.get(
    '/projects/:projectId/pipelines',
    zv('param', projectIdSchema),
    zv('query', pipelinesQuerySchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const binding = c.get('gitlabBinding')
      const { projectId } = c.req.valid('param')
      const { per_page, page } = c.req.valid('query')

      try {
        const pipelines = await listPipelines(teamId, binding, projectId, per_page, page)

        return c.json({ pipelines })
      } catch (e) {
        handleGitlabError(e, 'Failed to list pipelines')
      }
    },
  )
}
