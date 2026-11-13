import { canPrincipalsUseAllowList } from '@/lib/byos/access'
import { AppError } from '@/lib/errors'

import type { AgentRef } from '@/lib/agents/identity'
import type { BindingAccess } from '@/models'
import type { Context, Env, MiddlewareHandler } from 'hono'

type PrincipalVariables = {
  userId: string
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

/** Refuses the request unless every principal is on the binding's member list. */
export function requireBindingMemberAccess<E extends Env>(
  accessOf: (c: Context<E>) => BindingAccess | undefined,
  code: string,
  message: string,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const list = accessOf(c)?.memberAllowList

    if (!canPrincipalsUseAllowList(list, bindingAccessPrincipals(c as Context))) {
      throw new AppError(403, code, message)
    }
    await next()
  }
}
