import { z } from 'zod'

import { AppError } from '@/lib/errors'

import type { NuphosTeam } from '@/lib/identity/types'
import type { TeamAuthVariables } from '@/middleware/auth/types'
import type { BindingAccess } from '@/models'
import type { Context } from 'hono'

/** Who the member connecting a binding shares it with. */
export const bindingShareSchema = z.object({
  mode: z.enum(['private', 'team', 'members']),
  memberIds: z.array(z.string().min(1).max(128)).max(500).default([]),
})

export type BindingShare = z.infer<typeof bindingShareSchema>

/**
 * The member list a new binding starts with. It is private to the member who
 * connected it unless they share it, or the team shares new bindings by
 * default; a high-privilege binding ignores that default and stays private.
 */
export function initialBindingAccess(input: {
  userId: string
  team: Pick<NuphosTeam, 'bindingShareDefault'> | undefined
  share?: BindingShare
  highPrivilege?: boolean
  now?: Date
}): BindingAccess {
  const teamDefault =
    input.team?.bindingShareDefault === 'team' && !input.highPrivilege ? 'team' : 'private'
  const mode = input.share?.mode ?? teamDefault
  const members = mode === 'members' ? (input.share?.memberIds ?? []) : []

  return {
    memberAllowList: mode === 'team' ? ['*'] : [...new Set([input.userId, ...members])],
    ownerUserId: input.userId,
    updatedAt: input.now ?? new Date(),
    updatedBy: input.userId,
  }
}

/** The `share` a bind or start-oauth request names in its JSON body, as a field to store. */
export async function requestedBindingShare(
  c: Context<{ Variables: TeamAuthVariables }>,
): Promise<{ share?: BindingShare }> {
  const body: unknown = await c.req.json().catch(() => ({}))
  const parsed = z.object({ share: bindingShareSchema.optional() }).safeParse(body)

  if (!parsed.success) throw new AppError(400, 'invalid_share', 'share is not a valid choice')

  return parsed.data.share ? { share: parsed.data.share } : {}
}

/** The access for a binding this request connects, from the body's optional `share`. */
export async function newBindingAccess(
  c: Context<{ Variables: TeamAuthVariables }>,
  options: { highPrivilege?: boolean; now?: Date } = {},
): Promise<BindingAccess> {
  return initialBindingAccess({
    userId: c.get('userId'),
    team: c.get('team'),
    ...(await requestedBindingShare(c)),
    ...options,
  })
}
