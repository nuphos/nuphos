import { z } from 'zod'

import {
  listWorkerScripts,
  listWorkerDomains,
  getWorkerSettings,
  listWorkerCronTriggers,
  updateWorkerCronTriggers,
  listWorkerDeployments,
  getWorkerSubdomainEnabled,
  deleteWorkerScript,
} from '@/lib/byos/cloudflare-workers'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { accountHandleFor, parseNameParam } from '@/routes/cloudflare-accounts/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const workerCronSchema = z
  .object({ crons: z.array(z.string().trim().min(1).max(256)).max(100) })
  .strict()

export function registerCloudflareWorkerRoutes(
  accountScoped: Hono<{ Variables: CloudflareAccountVariables }>,
): void {
  accountScoped.get('/workers/scripts', async (c) => {
    const scripts = await listWorkerScripts(await accountHandleFor(c))

    return c.json({ scripts })
  })

  accountScoped.get('/workers/domains', async (c) => {
    const domains = await listWorkerDomains(await accountHandleFor(c))

    return c.json({ domains })
  })

  accountScoped.get('/workers/scripts/:scriptName/settings', async (c) => {
    const scriptName = parseNameParam(c.req.param('scriptName'), 'scriptName')
    const settings = await getWorkerSettings(await accountHandleFor(c), scriptName)

    return c.json(settings)
  })

  accountScoped.get('/workers/scripts/:scriptName/schedules', async (c) => {
    const scriptName = parseNameParam(c.req.param('scriptName'), 'scriptName')
    const schedules = await listWorkerCronTriggers(await accountHandleFor(c), scriptName)

    return c.json({ schedules })
  })

  accountScoped.put(
    '/workers/scripts/:scriptName/schedules',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', workerCronSchema),
    async (c) => {
      const scriptName = parseNameParam(c.req.param('scriptName'), 'scriptName')
      const schedules = await updateWorkerCronTriggers(
        await accountHandleFor(c),
        scriptName,
        c.req.valid('json').crons,
      )

      return c.json({ schedules })
    },
  )

  accountScoped.get('/workers/scripts/:scriptName/deployments', async (c) => {
    const scriptName = parseNameParam(c.req.param('scriptName'), 'scriptName')
    const deployments = await listWorkerDeployments(await accountHandleFor(c), scriptName)

    return c.json({ deployments })
  })

  accountScoped.get('/workers/scripts/:scriptName/subdomain', async (c) => {
    const scriptName = parseNameParam(c.req.param('scriptName'), 'scriptName')
    const enabled = await getWorkerSubdomainEnabled(await accountHandleFor(c), scriptName)

    return c.json({ enabled })
  })

  accountScoped.delete(
    '/workers/scripts/:scriptName',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const scriptName = parseNameParam(c.req.param('scriptName'), 'scriptName')

      await deleteWorkerScript(await accountHandleFor(c), scriptName)

      return c.body(null, 204)
    },
  )
}
