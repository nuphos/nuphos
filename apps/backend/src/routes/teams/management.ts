import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { OPENAB_PROVIDERS } from '@/lib/claude-code-preview/runtime-provider'
import { extractEmailDomain, isPublicEmailDomain } from '@/lib/email-domains'
import { AppError } from '@/lib/errors'
import {
  deleteTeam,
  getTeamMembers,
  leaveTeam,
  removeUserFromTeam,
  setTeamAgentRuntime,
  setTeamAllowedEmailDomains,
  updateTeam,
  updateTeamMemberRole,
} from '@/lib/identity'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    avatarUrl: z.string().trim().max(2048).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.avatarUrl !== undefined, {
    message: 'At least one field is required',
  })

const updateTeamMemberRoleSchema = z
  .object({
    role: z.enum(['ADMINISTRATOR', 'EDITOR', 'VIEWER']),
  })
  .strict()

const updateEmailDomainDiscoverySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()

const updateAgentRuntimeSchema = z
  .object({
    runtime: z.enum(OPENAB_PROVIDERS),
  })
  .strict()

export function registerTeamManagementRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get('/', (c) => {
    const team = c.get('team')
    const userId = c.get('userId')

    return c.json({
      ...team,
      isOwner: team.ownerID === userId,
      role: c.get('teamRole'),
    })
  })

  teamScoped.patch(
    '/',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('json', updateTeamSchema),
    async (c) => {
      const input = c.req.valid('json')
      const team = await updateTeam(c.get('teamId'), c.get('userId'), input)

      if (!team) {
        throw new AppError(404, 'team_not_found', 'Team not found')
      }

      return c.json({
        ...team,
        isOwner: team.ownerID === c.get('userId'),
        role: c.get('teamRole'),
      })
    },
  )

  teamScoped.put(
    '/agent-runtime',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', updateAgentRuntimeSchema),
    async (c) => {
      const { runtime } = c.req.valid('json')
      const team = await setTeamAgentRuntime(c.get('teamId'), runtime)

      if (!team) {
        throw new AppError(404, 'team_not_found', 'Team not found')
      }

      return c.json({
        ...team,
        isOwner: team.ownerID === c.get('userId'),
        role: c.get('teamRole'),
      })
    },
  )

  teamScoped.put(
    '/allowed-email-domains',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', updateEmailDomainDiscoverySchema),
    async (c) => {
      const { enabled } = c.req.valid('json')
      // The joinable domain is always the acting admin's own email domain —
      // never free-form — so a workspace can only open itself to a domain one
      // of its admins verifiably belongs to.
      let domains: string[] = []

      if (enabled) {
        const domain = extractEmailDomain(c.get('userEmail'))

        if (!domain) {
          throw new AppError(400, 'invalid_domain', 'Your account email has no usable domain')
        }
        if (isPublicEmailDomain(domain)) {
          throw new AppError(
            400,
            'public_domain_not_allowed',
            `${domain} is a public email provider and cannot be used for workspace discovery`,
          )
        }
        domains = [domain]
      }
      const team = await setTeamAllowedEmailDomains(c.get('teamId'), domains)

      if (!team) {
        throw new AppError(404, 'team_not_found', 'Team not found')
      }

      return c.json({
        ...team,
        isOwner: team.ownerID === c.get('userId'),
        role: c.get('teamRole'),
      })
    },
  )

  teamScoped.get('/members', async (c) => {
    const includeRemoved = c.req.query('includeRemoved') === 'true'
    const members = await getTeamMembers(c.get('teamId'), { includeRemoved })

    return c.json({ members })
  })

  teamScoped.get('/members/:memberId', async (c) => {
    const includeRemoved = c.req.query('includeRemoved') === 'true'
    const members = await getTeamMembers(c.get('teamId'), { includeRemoved })
    const matches = members.filter((candidate) => candidate.id === c.req.param('memberId'))
    const member = matches.find((candidate) => !candidate.removedAt) ?? matches.at(-1)

    if (!member) throw new AppError(404, 'member_not_found', 'Team member not found')

    return c.json({ member })
  })

  teamScoped.patch(
    '/members/:memberId',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', updateTeamMemberRoleSchema),
    async (c) => {
      const memberId = c.req.param('memberId')

      if (!ObjectId.isValid(memberId)) {
        throw new AppError(400, 'invalid_id', `Invalid memberId: ${memberId}`)
      }

      const { role } = c.req.valid('json')
      const result = await updateTeamMemberRole(c.get('teamId'), memberId, role, c.get('userId'))

      if (result.kind === 'updated') {
        return c.json({ member: result.member })
      }
      if (result.kind === 'team_not_found' || result.kind === 'member_not_found') {
        throw new AppError(404, 'member_not_found', 'Member not found')
      }
      if (result.kind === 'owner') {
        throw new AppError(409, 'cannot_change_owner_role', 'The team owner role cannot be changed')
      }
      if (result.kind === 'self') {
        throw new AppError(409, 'cannot_change_self_role', 'You cannot change your own role')
      }
      if (result.kind === 'forbidden') {
        throw new AppError(403, 'forbidden', 'Requires team administrator')
      }
      throw new AppError(409, 'cannot_remove_last_admin', 'The last team admin cannot be demoted')
    },
  )

  teamScoped.delete('/members/:memberId', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const memberId = c.req.param('memberId')

    if (!ObjectId.isValid(memberId)) {
      throw new AppError(400, 'invalid_id', `Invalid memberId: ${memberId}`)
    }

    const result = await removeUserFromTeam(c.get('teamId'), memberId, c.get('userId'))

    if (result === 'removed') {
      return c.body(null, 204)
    }
    if (result === 'team_not_found' || result === 'member_not_found') {
      throw new AppError(404, 'member_not_found', 'Member not found')
    }
    if (result === 'owner') {
      throw new AppError(409, 'cannot_remove_owner', 'The team owner cannot be removed')
    }
    if (result === 'self') {
      throw new AppError(409, 'cannot_remove_self', 'You cannot remove yourself from the team')
    }
    if (result === 'forbidden') {
      throw new AppError(403, 'forbidden', 'Requires team administrator')
    }
    throw new AppError(409, 'cannot_remove_last_admin', 'The last team admin cannot be removed')
  })

  // Disband the whole team. Owner-only (enforced inside deleteTeam); the
  // ADMINISTRATOR gate just rejects non-admins early with a clean 403.
  teamScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const result = await deleteTeam(c.get('teamId'), c.get('userId'))

    if (result === 'deleted') {
      return c.body(null, 204)
    }
    if (result === 'team_not_found') {
      throw new AppError(404, 'team_not_found', 'Team not found')
    }
    throw new AppError(403, 'forbidden', 'Only the team owner can delete the team')
  })

  // Self-leave: any member removes their own membership. No role gate — the
  // owner and last-admin guards live inside leaveTeam.
  teamScoped.post('/leave', async (c) => {
    const result = await leaveTeam(c.get('teamId'), c.get('userId'))

    if (result === 'left') {
      return c.body(null, 204)
    }
    if (result === 'team_not_found' || result === 'member_not_found') {
      throw new AppError(404, 'team_not_found', 'Team not found')
    }
    if (result === 'owner') {
      throw new AppError(
        409,
        'cannot_leave_as_owner',
        'The team owner cannot leave; delete the team or transfer ownership first',
      )
    }
    throw new AppError(
      409,
      'cannot_leave_as_last_admin',
      'The last team admin cannot leave the team',
    )
  })
}
