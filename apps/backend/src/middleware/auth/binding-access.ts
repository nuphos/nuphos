import { canEditAccess, canPrincipalsUseAllowList, canUseBinding } from '@/lib/byos/access'
import { AppError } from '@/lib/errors'

import type { AgentRef } from '@/lib/agents/identity'
import type { TeamAuthVariables } from '@/middleware/auth/types'
import type { BindingAccess } from '@/models'
import type { Context, Env, MiddlewareHandler } from 'hono'

type PrincipalVariables = {
  userId: string
  teamRole?: string
  agent?: AgentRef
  conversationAgent?: AgentRef
}

/**
 * Everyone a request acts for: the caller, plus the sender and the owner of
 * the conversation when it comes with a conversation token.
 */
export function bindingAccessPrincipals(c: Context): string[] {
  const vars = c.var as unknown as PrincipalVariables
  const agent = vars.agent ?? vars.conversationAgent
  const ids = [vars.userId]

  if (agent) ids.push(agent.userId, agent.conversationOwnerUserId ?? agent.userId)

  return [...new Set(ids)]
}

/**
 * Whether this request may use a binding. A member acting in the app follows
 * `canUseBinding`; a conversation token never gets the admin exception, so
 * every principal it acts for must be on the list.
 */
export function canRequestUseBinding(c: Context, access: BindingAccess | undefined): boolean {
  const vars = c.var as unknown as PrincipalVariables

  if (!vars.agent && !vars.conversationAgent) {
    return canUseBinding(access, vars.userId, vars.teamRole)
  }

  return canPrincipalsUseAllowList(access?.memberAllowList, bindingAccessPrincipals(c))
}

/** Refuses the request unless `canRequestUseBinding` allows it. */
export function requireBindingMemberAccess<E extends Env>(
  accessOf: (c: Context<E>) => BindingAccess | undefined,
  code: string,
  message: string,
): MiddlewareHandler<E> {
  return async (c, next) => {
    if (!canRequestUseBinding(c as Context, accessOf(c))) {
      throw new AppError(403, code, message)
    }
    await next()
  }
}

/**
 * Only its owner may disconnect a private binding; an admin may disconnect a
 * shared one or one without an owner. Otherwise an admin could disconnect a
 * member's private cloud binding and connect the same role again as their own.
 */
export function requireCanDisconnect(
  /** The context key holding the binding (`…Binding`) or its member list (`…Access`). */
  key: string,
): MiddlewareHandler {
  return async (c, next) => {
    const value = (c as unknown as { get: (k: string) => unknown }).get(key)
    const access = (
      key.endsWith('Binding') ? (value as { access?: BindingAccess } | undefined)?.access : value
    ) as BindingAccess | undefined

    if (!canEditAccess(access, c.get('userId'), c.get('teamRole'))) {
      throw new AppError(
        403,
        'binding_private',
        "Only its owner can disconnect another member's private binding",
      )
    }
    await next()
  }
}
