import { z } from 'zod'

import type { BindingAccess } from '@/models'

export type BindingAccessView = {
  memberAllowList: string[]
  updatedAt: Date | null
  updatedBy: string | null
}

const DEFAULT_ALLOW_LIST = ['*']
const MAX_ALLOW_LIST_ENTRIES = 500

export const allowListSchema = z
  .array(z.string().min(1).max(128))
  .max(MAX_ALLOW_LIST_ENTRIES, `Allow list cannot exceed ${String(MAX_ALLOW_LIST_ENTRIES)} entries`)
  .superRefine((list, ctx) => {
    if (list.includes('*') && list.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'*' must be the only value when present",
      })
    }
  })

export const bindingAccessUpdateSchema = z.object({
  memberAllowList: allowListSchema,
})

export function createDefaultAccess(userId: string, now = new Date()): BindingAccess {
  return {
    memberAllowList: [...DEFAULT_ALLOW_LIST],
    updatedAt: now,
    updatedBy: userId,
  }
}

/**
 * Default access for bindings whose credential cannot be scoped down on the
 * provider side, so the blast radius of a leak is the whole account (Upstash:
 * a Management API key has no scopes, and can read/write every database's data
 * via its rest_token). Those start closed — only the binder — instead of the
 * `['*']` every-member default.
 *
 * Admins are not baked in here either: a binding only its binder may use is
 * private, and `canUseBinding` gives admins no way into it.
 */
export function createBinderOnlyAccess(userId: string, now = new Date()): BindingAccess {
  return {
    memberAllowList: [userId],
    ownerUserId: userId,
    updatedAt: now,
    updatedBy: userId,
  }
}

export function accessView(access: BindingAccess | undefined): BindingAccessView {
  return {
    memberAllowList: normalizeAllowList(access?.memberAllowList),
    updatedAt: access?.updatedAt ?? null,
    updatedBy: access?.updatedBy ?? null,
  }
}

export function normalizeAccessInput(
  input: {
    memberAllowList: string[]
  },
  userId: string,
  now = new Date(),
  ownerUserId?: string,
): BindingAccess {
  return {
    memberAllowList: normalizeAllowList(input.memberAllowList),
    ...(ownerUserId ? { ownerUserId } : {}),
    updatedAt: now,
    updatedBy: userId,
  }
}

export function canUseAllowList(list: string[] | undefined, userId: string): boolean {
  const normalized = normalizeAllowList(list)

  return normalized.includes('*') || normalized.includes(userId)
}

/**
 * A binding no one but its owner may use. Without a recorded owner, a list
 * of at most one member counts as that member's own.
 */
export function isPrivateAccess(access: BindingAccess | undefined): boolean {
  const list = normalizeAllowList(access?.memberAllowList)

  if (list.includes('*')) return false
  const owner = access?.ownerUserId

  return owner ? list.every((id) => id === owner) : list.length <= 1
}

/** Who connected the binding: its recorded owner, or the one member of an older private list. */
export function bindingOwner(access: BindingAccess | undefined): string | undefined {
  if (access?.ownerUserId) return access.ownerUserId
  const list = normalizeAllowList(access?.memberAllowList)

  return list.length === 1 && list[0] !== '*' ? list[0] : undefined
}

/** Admins and the binding's owner may see who it is shared with. */
export function canViewAccess(
  access: BindingAccess | undefined,
  userId: string,
  teamRole: string | undefined,
): boolean {
  return teamRole === 'ADMINISTRATOR' || bindingOwner(access) === userId
}

/**
 * Its owner may always change who a binding is shared with; an admin only
 * while it is shared, never another member's private binding.
 */
export function canEditAccess(
  access: BindingAccess | undefined,
  userId: string,
  teamRole: string | undefined,
): boolean {
  if (bindingOwner(access) === userId) return true

  return teamRole === 'ADMINISTRATOR' && !isPrivateAccess(access)
}

/**
 * The one rule for every binding: members on the list may use it, and admins
 * may use any binding shared with the team or specific people, but never
 * another member's private one.
 */
export function canUseBinding(
  access: BindingAccess | undefined,
  userId: string,
  teamRole: string | undefined,
): boolean {
  if (canUseAllowList(access?.memberAllowList, userId)) return true

  return teamRole === 'ADMINISTRATOR' && !isPrivateAccess(access)
}

/** A binding is usable only when every principal a request acts for is on its list. */
export function canPrincipalsUseAllowList(
  list: string[] | undefined,
  principals: readonly string[],
): boolean {
  return principals.length > 0 && principals.every((id) => canUseAllowList(list, id))
}

function normalizeAllowList(list: string[] | undefined): string[] {
  if (list === undefined) return [...DEFAULT_ALLOW_LIST]
  if (list.includes('*')) return [...DEFAULT_ALLOW_LIST]

  return Array.from(new Set(list))
}
