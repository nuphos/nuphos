import { canPrincipalsUseAllowList, canUseBinding } from '@/lib/byos/access'
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
 * Refuses binding a cloud identity again when it is already bound to a
 * binding this request may not use. GCP and Azure bindings are scoped to a
 * project or subscription, but the token is the identity's, so a second
 * binding under another scope would hand out a member's private credentials.
 */
export function assertMayBindIdentity(
  c: Context,
  bindings: readonly { access?: BindingAccess }[],
  identity: string,
): void {
  if (bindings.some((binding) => !canRequestUseBinding(c, binding.access))) {
    throw new AppError(
      403,
      'identity_bound_privately',
      `${identity} is already connected privately by another member`,
    )
  }
}

/**
 * The account and role name a cloud role ARN or TRN names, in lower case:
 * AWS, Tencent, Aliyun and Volcengine treat role names case-insensitively, so
 * two spellings of one role must compare equal.
 */
export function roleIdentity(arn: string): string {
  const account = /(?:::|uin\/)(\d+)/.exec(arn)?.[1] ?? ''
  const name = arn.slice(arn.lastIndexOf('/') + 1)

  return `${account}/${name}`.toLowerCase()
}

/** Refuses binding a role another member holds privately, in any spelling. */
export function assertMayBindRole(
  c: Context,
  bindings: readonly { access?: BindingAccess }[],
  arnOf: (binding: never) => string,
  arn: string,
): void {
  const identity = roleIdentity(arn)

  assertMayBindIdentity(
    c,
    bindings.filter((binding) => roleIdentity(arnOf(binding as never)) === identity),
    `Role ${arn}`,
  )
}
