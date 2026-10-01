import { z } from 'zod'

import { getAwsAccountAlias } from '@/lib/byos/aws'
import {
  listVpcs,
  getVpc,
  listNacls,
  getNacl,
  replaceNaclEntries,
  listEc2Instances,
  getEc2InstanceSshAccess,
} from '@/lib/byos/aws-ec2'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { optionalRegionQuerySchema } from '@/routes/aws-accounts/schemas'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const naclEntrySchema = z.object({
  ruleNumber: z.number().int().min(1).max(32766),
  ruleAction: z.enum(['allow', 'deny']),
  egress: z.boolean(),
  protocol: z.string(),
  cidrBlock: z.string().optional(),
  ipv6CidrBlock: z.string().optional(),
  portRange: z
    .object({
      from: z.number().int().min(0).max(65535),
      to: z.number().int().min(0).max(65535),
    })
    .optional(),
})

const replaceEntriesSchema = z.object({ entries: z.array(naclEntrySchema) })

const ec2SshAccessSchema = z.object({
  region: z.string().trim().min(1).optional(),
  username: z.string().trim().min(1).max(64).optional(),
})

export function registerAwsEc2Routes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/', async (c) => {
    const roleArn = c.get('awsRoleArn')
    const alias = await getAwsAccountAlias(roleArn).catch(() => null)

    return c.json({
      roleId: c.get('awsBinding').id.toHexString(),
      accountId: c.get('accountId'),
      alias,
      roleArn,
    })
  })

  accountScoped.get('/vpcs', async (c) => {
    const region = c.req.query('region') || undefined
    const vpcs = await listVpcs(c.get('awsRoleArn'), region ? { region } : undefined)

    return c.json({ vpcs })
  })

  accountScoped.get('/vpcs/:id', async (c) => {
    const id = c.req.param('id')
    const vpc = await getVpc(c.get('awsRoleArn'), id)

    if (!vpc) throw new AppError(404, 'vpc_not_found', `VPC ${id} not found`)

    return c.json(vpc)
  })

  accountScoped.get('/nacls', async (c) => {
    const region = c.req.query('region') || undefined
    const vpcId = c.req.query('vpcId') || undefined
    const nacls = await listNacls(c.get('awsRoleArn'), { region, vpcId })

    return c.json({ nacls })
  })

  accountScoped.get('/nacls/:id', async (c) => {
    const id = c.req.param('id')
    const nacl = await getNacl(c.get('awsRoleArn'), id)

    if (!nacl) throw new AppError(404, 'nacl_not_found', `NACL ${id} not found`)

    return c.json(nacl)
  })

  accountScoped.patch(
    '/nacls/:id/entries',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', replaceEntriesSchema),
    async (c) => {
      const id = c.req.param('id')
      const { entries } = c.req.valid('json')
      const updated = await replaceNaclEntries(c.get('awsRoleArn'), id, entries)

      return c.json(updated)
    },
  )

  accountScoped.get('/ec2-instances', zv('query', optionalRegionQuerySchema), async (c) => {
    const { region } = c.req.valid('query')
    const instances = await listEc2Instances(c.get('awsRoleArn'), region ? { region } : undefined)

    return c.json({ instances })
  })

  accountScoped.post(
    '/ec2-instances/:instanceId/ssh-access',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', ec2SshAccessSchema),
    async (c) => {
      const instanceId = c.req.param('instanceId')
      const { region, username } = c.req.valid('json')
      const access = await getEc2InstanceSshAccess(c.get('awsRoleArn'), instanceId, {
        region,
        username,
      })

      return c.json(access)
    },
  )
}
