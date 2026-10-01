import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { findTailscaleClient } from '@/lib/byos/account'
import {
  assertTailnetTag,
  renderTailnetAclSnippet,
  requireTailnetSandboxTag,
} from '@/lib/byos/tailnet-access'
import { listTailscaleDevices, mintTailscaleAccessToken } from '@/lib/byos/tailscale'
import { tailscaleAuthHandle } from '@/lib/byos/tailscale-binding'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTailscaleMemberAccess, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { publicView } from '@/routes/tailscale-clients/shared'

import type { TailscaleClientVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const sandboxAccessSchema = z
  .object({
    enabled: z.boolean(),
    tag: z.string().trim().min(1).max(70),
  })
  .strict()

const aclSnippetSchema = z
  .object({
    targetTag: z.string().trim().min(1).max(70),
    sshUsers: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    recorderTag: z.string().trim().min(1).max(70).optional(),
  })
  .strict()

function handleFor(c: {
  get: <K extends keyof TailscaleClientVariables>(k: K) => TailscaleClientVariables[K]
}) {
  return tailscaleAuthHandle(
    c.get('tailscaleBindingAuth'),
    parseObjectId(c.get('teamId'), 'teamId'),
  )
}

export function registerTailscaleClientScopedRoutes(
  clientScoped: Hono<{ Variables: TailscaleClientVariables }>,
) {
  clientScoped.get('/', (c) => {
    return c.json({
      id: c.get('tailscaleClientId'),
      label: c.get('tailscaleClientLabel'),
      clientId: c.get('tailscaleClientOAuthId'),
    })
  })

  clientScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const clientId = new ObjectId(c.get('tailscaleClientId'))
    const result = await teamByosBindings().updateOne(
      { _id: teamId, 'tailscaleClients.id': clientId },
      {
        $pull: { tailscaleClients: { id: clientId } },
        $set: { updatedAt: new Date() },
      },
    )

    if (result.matchedCount === 0) {
      throw new AppError(404, 'tailscale_client_not_bound', 'Tailscale OAuth client not found')
    }

    return c.body(null, 204)
  })

  clientScoped.get('/credentials', requireTailscaleMemberAccess(), async (c) => {
    const token = await mintTailscaleAccessToken(handleFor(c)).catch((err: unknown) => {
      throw new AppError(502, 'tailscale_api_error', (err as Error).message)
    })

    return c.json({
      clientId: c.get('tailscaleClientId'),
      label: c.get('tailscaleClientLabel'),
      oauthClientId: c.get('tailscaleClientOAuthId'),
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
      scope: token.scope,
      tailnet: '-',
    })
  })

  // Turning this on is what lets an agent sandbox join the tailnet as a node.
  // Administrator-only, and recorded, because it is a strictly larger grant than
  // the binding itself carries.
  clientScoped.put(
    '/sandbox-access',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', sandboxAccessSchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const clientId = new ObjectId(c.get('tailscaleClientId'))
      const { enabled, tag } = c.req.valid('json')

      assertTailnetTag(tag)

      const now = new Date()
      const result = await teamByosBindings().updateOne(
        { _id: teamId, 'tailscaleClients.id': clientId },
        {
          $set: {
            'tailscaleClients.$.sandboxAccess': {
              enabled,
              tag,
              enabledBy: new ObjectId(c.get('userId')),
              enabledAt: now,
            },
            updatedAt: now,
          },
        },
      )

      if (result.matchedCount === 0) {
        throw new AppError(404, 'tailscale_client_not_bound', 'Tailscale OAuth client not found')
      }

      const binding = await findTailscaleClient(teamId, clientId)

      if (!binding) {
        throw new AppError(404, 'tailscale_client_not_bound', 'Tailscale OAuth client not found')
      }

      return c.json(publicView(binding))
    },
  )

  // The customer's half of the setup, rendered for them to review and commit.
  // Nuphos never writes the tailnet policy file itself.
  clientScoped.post(
    '/acl-snippet',
    requireTailscaleMemberAccess(),
    zv('json', aclSnippetSchema),
    async (c) => {
      // Turning access off leaves the tag on the binding, so checking only for
      // presence would keep handing out a working snippet for a tag an admin
      // has just revoked.
      const tag = requireTailnetSandboxTag(c.get('tailscaleSandboxAccess'))
      const { targetTag, sshUsers, recorderTag } = c.req.valid('json')

      return c.json({
        snippet: renderTailnetAclSnippet({
          tag,
          targetTag,
          sshUsers: sshUsers ?? [],
          recorderTag,
        }),
      })
    },
  )

  clientScoped.get('/devices', requireTailscaleMemberAccess(), async (c) => {
    const devices = await listTailscaleDevices(handleFor(c)).catch((err: unknown) => {
      throw new AppError(502, 'tailscale_api_error', (err as Error).message)
    })

    return c.json({ devices })
  })
}
