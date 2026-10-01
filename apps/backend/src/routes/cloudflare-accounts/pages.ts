import { z } from 'zod'

import {
  listPagesProjects,
  getPagesProject,
  deletePagesProject,
  listPagesDeployments,
  createPagesDeployment,
  retryPagesDeployment,
  rollbackPagesDeployment,
  getPagesDeploymentLogs,
  listPagesDomains,
  addPagesDomain,
  deletePagesDomain,
} from '@/lib/byos/cloudflare-pages'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import {
  accountHandleFor,
  parseCloudflareIdParam,
  parseNameParam,
} from '@/routes/cloudflare-accounts/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const pagesDeploymentSchema = z
  .object({ branch: z.string().trim().min(1).max(256).optional() })
  .strict()

const pagesDomainSchema = z.object({ name: z.string().trim().min(1).max(256) }).strict()

export function registerCloudflarePagesRoutes(
  accountScoped: Hono<{ Variables: CloudflareAccountVariables }>,
): void {
  accountScoped.get('/pages/projects', async (c) => {
    const projects = await listPagesProjects(await accountHandleFor(c))

    return c.json({ projects })
  })

  accountScoped.get('/pages/projects/:projectName', async (c) => {
    const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
    const project = await getPagesProject(await accountHandleFor(c), projectName)

    return c.json(project)
  })

  accountScoped.delete(
    '/pages/projects/:projectName',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const projectName = parseNameParam(c.req.param('projectName'), 'projectName')

      await deletePagesProject(await accountHandleFor(c), projectName)

      return c.body(null, 204)
    },
  )

  accountScoped.get('/pages/projects/:projectName/deployments', async (c) => {
    const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
    const deployments = await listPagesDeployments(await accountHandleFor(c), projectName)

    return c.json({ deployments })
  })

  accountScoped.post(
    '/pages/projects/:projectName/deployments',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', pagesDeploymentSchema),
    async (c) => {
      const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
      const deployment = await createPagesDeployment(
        await accountHandleFor(c),
        projectName,
        c.req.valid('json').branch,
      )

      return c.json(deployment, 201)
    },
  )

  accountScoped.post(
    '/pages/projects/:projectName/deployments/:deploymentId/retry',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
      const deploymentId = parseCloudflareIdParam(c.req.param('deploymentId'), 'deploymentId')
      const deployment = await retryPagesDeployment(
        await accountHandleFor(c),
        projectName,
        deploymentId,
      )

      return c.json(deployment)
    },
  )

  accountScoped.post(
    '/pages/projects/:projectName/deployments/:deploymentId/rollback',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
      const deploymentId = parseCloudflareIdParam(c.req.param('deploymentId'), 'deploymentId')
      const deployment = await rollbackPagesDeployment(
        await accountHandleFor(c),
        projectName,
        deploymentId,
      )

      return c.json(deployment)
    },
  )

  accountScoped.get('/pages/projects/:projectName/deployments/:deploymentId/logs', async (c) => {
    const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
    const deploymentId = parseCloudflareIdParam(c.req.param('deploymentId'), 'deploymentId')
    const logs = await getPagesDeploymentLogs(await accountHandleFor(c), projectName, deploymentId)

    return c.json({ logs })
  })

  accountScoped.get('/pages/projects/:projectName/domains', async (c) => {
    const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
    const domains = await listPagesDomains(await accountHandleFor(c), projectName)

    return c.json({ domains })
  })

  accountScoped.post(
    '/pages/projects/:projectName/domains',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', pagesDomainSchema),
    async (c) => {
      const projectName = parseNameParam(c.req.param('projectName'), 'projectName')

      await addPagesDomain(await accountHandleFor(c), projectName, c.req.valid('json').name)

      return c.body(null, 201)
    },
  )

  accountScoped.delete(
    '/pages/projects/:projectName/domains/:domainName',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const projectName = parseNameParam(c.req.param('projectName'), 'projectName')
      const domainName = parseNameParam(c.req.param('domainName'), 'domainName')

      await deletePagesDomain(await accountHandleFor(c), projectName, domainName)

      return c.body(null, 204)
    },
  )
}
