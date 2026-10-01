import { z } from 'zod'

import {
  createCloudflareDnsRecord,
  deleteCloudflareDnsRecord,
  listCloudflareDnsRecords,
  listCloudflareZones,
  updateCloudflareDnsRecord,
} from '@/lib/byos/cloudflare'
import {
  getCloudflareIamPermissions,
  getCloudflareOauthConnection,
} from '@/lib/byos/cloudflare-iam'
import { invalidateCloudflareAccessToken } from '@/lib/byos/cloudflare-oauth'
import { decryptCloudflareApiKey } from '@/lib/byos/secrets'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { accountHandleFor, parseCloudflareIdParam } from '@/routes/cloudflare-accounts/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const dnsRecordSchema = z
  .object({
    type: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(
        z.enum([
          'A',
          'AAAA',
          'CAA',
          'CERT',
          'CNAME',
          'DNSKEY',
          'DS',
          'HTTPS',
          'LOC',
          'MX',
          'NAPTR',
          'NS',
          'PTR',
          'SMIMEA',
          'SRV',
          'SSHFP',
          'SVCB',
          'TLSA',
          'TXT',
          'URI',
        ]),
      ),
    name: z.string().trim().min(1),
    content: z.string().trim().min(1),
    ttl: z.number().int().min(1).max(2147483647).optional(),
    proxied: z.boolean().optional(),
    priority: z.number().int().min(0).max(65535).optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .transform((v) => ({
    ...v,
    ttl: v.ttl ?? 1,
  }))

export function registerCloudflareAccountRoutes(
  accountScoped: Hono<{ Variables: CloudflareAccountVariables }>,
): void {
  accountScoped.get('/', (c) => {
    return c.json({
      accountId: c.get('cloudflareAccountId'),
      accountName: c.get('cloudflareAccountName'),
    })
  })

  accountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = c.get('cloudflareAccountId')
    const binding = c.get('cloudflareBinding')

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $pull: { cloudflareAccounts: { accountId } },
        $set: { updatedAt: new Date() },
      },
    )
    invalidateCloudflareAccessToken(teamId, binding.id)

    return c.body(null, 204)
  })

  accountScoped.get('/credentials', (c) => {
    // OAuth access tokens stay server-side — they are broader than a scoped API
    // token and the backend already proxies every Cloudflare call. Only legacy
    // api_token bindings export their (user-scoped) key.
    const binding = c.get('cloudflareBinding')

    if (binding.oauth) {
      return c.json({
        accountId: c.get('cloudflareAccountId'),
        accountName: c.get('cloudflareAccountName'),
        authType: 'oauth' as const,
      })
    }

    return c.json({
      accountId: c.get('cloudflareAccountId'),
      accountName: c.get('cloudflareAccountName'),
      authType: 'api_token' as const,
      ...(binding.encryptedApiKey
        ? { apiKey: decryptCloudflareApiKey(binding.encryptedApiKey) }
        : {}),
    })
  })

  accountScoped.get('/zones', async (c) => {
    const zones = await listCloudflareZones(await accountHandleFor(c))

    return c.json({ zones })
  })

  accountScoped.get('/iam-permissions', async (c) => {
    const binding = c.get('cloudflareBinding')

    // OAuth bindings (current bind flow) have no inspectable API token — report
    // the granted scopes + connection health instead of token policies. A failed
    // token refresh degrades to connectionStatus 'error' rather than a 500 so
    // the page can tell the user to reconnect.
    if (binding.oauth) {
      const warnings: string[] = []
      let handle = null

      try {
        handle = await accountHandleFor(c)
      } catch (e) {
        warnings.push(
          `Could not refresh the OAuth access token: ${e instanceof Error ? e.message : String(e)}`,
        )
      }

      return c.json(
        await getCloudflareOauthConnection(
          handle,
          {
            accountId: binding.accountId,
            accountName: binding.accountName,
            clientId: binding.oauth.clientId,
            scope: binding.oauth.scope,
            accessTokenExpiresAt: binding.oauth.accessTokenExpiresAt,
            hasRefreshToken: !!binding.oauth.encryptedRefreshToken,
          },
          warnings,
        ),
      )
    }
    const result = await getCloudflareIamPermissions(await accountHandleFor(c))

    return c.json({ ...result, authType: 'api_token' as const })
  })

  accountScoped.get('/zones/:zoneId/dns-records', async (c) => {
    const zoneId = parseCloudflareIdParam(c.req.param('zoneId'), 'zoneId')
    const records = await listCloudflareDnsRecords(await accountHandleFor(c), zoneId)

    return c.json({ records })
  })

  accountScoped.post(
    '/zones/:zoneId/dns-records',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', dnsRecordSchema),
    async (c) => {
      const zoneId = parseCloudflareIdParam(c.req.param('zoneId'), 'zoneId')
      const record = await createCloudflareDnsRecord(
        await accountHandleFor(c),
        zoneId,
        c.req.valid('json'),
      )

      return c.json(record, 201)
    },
  )

  accountScoped.put(
    '/zones/:zoneId/dns-records/:recordId',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', dnsRecordSchema),
    async (c) => {
      const zoneId = parseCloudflareIdParam(c.req.param('zoneId'), 'zoneId')
      const recordId = parseCloudflareIdParam(c.req.param('recordId'), 'recordId')
      const record = await updateCloudflareDnsRecord(
        await accountHandleFor(c),
        zoneId,
        recordId,
        c.req.valid('json'),
      )

      return c.json(record)
    },
  )

  accountScoped.delete(
    '/zones/:zoneId/dns-records/:recordId',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const zoneId = parseCloudflareIdParam(c.req.param('zoneId'), 'zoneId')
      const recordId = parseCloudflareIdParam(c.req.param('recordId'), 'recordId')

      await deleteCloudflareDnsRecord(await accountHandleFor(c), zoneId, recordId)

      return c.body(null, 204)
    },
  )
}
