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
 * Team admins are NOT baked in here: roles change, and a frozen list would both
 * miss admins promoted later and keep access for admins demoted since. The
 * admin grant is evaluated per request at the gate instead.
 */
export function createBinderOnlyAccess(userId: string, now = new Date()): BindingAccess {
  return {
    memberAllowList: [userId],
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
): BindingAccess {
  return {
    memberAllowList: normalizeAllowList(input.memberAllowList),
    updatedAt: now,
    updatedBy: userId,
  }
}

export function canUseAllowList(list: string[] | undefined, userId: string): boolean {
  const normalized = normalizeAllowList(list)

  return normalized.includes('*') || normalized.includes(userId)
}

function normalizeAllowList(list: string[] | undefined): string[] {
  if (list === undefined) return [...DEFAULT_ALLOW_LIST]
  if (list.includes('*')) return [...DEFAULT_ALLOW_LIST]

  return Array.from(new Set(list))
}
