import { z } from 'zod'

import {
  getGcpFirewall,
  getGcpVpc,
  listGceInstances,
  listGcpFirewalls,
  listGcpVpcs,
  patchGcpFirewall,
} from '@/lib/byos/gcp-compute'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import { handleFor } from './handle'

import type { GcpProjectVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const firewallPatchSchema = z.object({
  priority: z.number().int().min(0).max(65535).optional(),
  disabled: z.boolean().optional(),
  sourceRanges: z.array(z.string()).optional(),
  destinationRanges: z.array(z.string()).optional(),
  sourceTags: z.array(z.string()).optional(),
  targetTags: z.array(z.string()).optional(),
  allowed: z
    .array(z.object({ ipProtocol: z.string(), ports: z.array(z.string()).optional() }))
    .optional(),
  denied: z
    .array(z.object({ ipProtocol: z.string(), ports: z.array(z.string()).optional() }))
    .optional(),
  description: z.string().optional(),
})

export function registerGcpComputeRoutes(
  projectScoped: Hono<{ Variables: GcpProjectVariables }>,
): void {
  projectScoped.get('/vpcs', async (c) => {
    const vpcs = await listGcpVpcs(handleFor(c))

    return c.json({ vpcs })
  })

  projectScoped.get('/vpcs/:name', async (c) => {
    const name = c.req.param('name')
    const vpc = await getGcpVpc(handleFor(c), name)

    if (!vpc) throw new AppError(404, 'vpc_not_found', `VPC ${name} not found`)

    return c.json(vpc)
  })

  projectScoped.get('/firewalls', async (c) => {
    const firewalls = await listGcpFirewalls(handleFor(c))

    return c.json({ firewalls })
  })

  projectScoped.get('/firewalls/:name', async (c) => {
    const name = c.req.param('name')
    const fw = await getGcpFirewall(handleFor(c), name)

    if (!fw) throw new AppError(404, 'firewall_not_found', `Firewall rule ${name} not found`)

    return c.json(fw)
  })

  projectScoped.patch(
    '/firewalls/:name',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', firewallPatchSchema),
    async (c) => {
      const name = c.req.param('name')
      const patch = c.req.valid('json')
      const updated = await patchGcpFirewall(handleFor(c), name, patch)

      return c.json(updated)
    },
  )

  projectScoped.get('/gce-instances', async (c) => {
    const instances = await listGceInstances(handleFor(c))

    return c.json({ instances })
  })
}
