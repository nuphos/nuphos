import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import {
  findTailscaleClient,
  findLinearWorkspace,
  findJiraSite,
  findAsanaAccount,
  findSentryAccount,
} from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type {
  AsanaAccountVariables,
  JiraSiteVariables,
  LinearWorkspaceVariables,
  SentryAccountVariables,
  TailscaleClientVariables,
} from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

export function requireTailscaleClient(): MiddlewareHandler<{
  Variables: TailscaleClientVariables
}> {
  return async (c, next) => {
    const param = c.req.param('clientId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_client_id', 'clientId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findTailscaleClient(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'tailscale_client_not_bound',
        `Tailscale OAuth client ${param} is not bound to this team`,
      )
    }
    c.set('tailscaleClientId', param)
    c.set('tailscaleClientLabel', binding.label)
    c.set('tailscaleClientOAuthId', binding.clientId)
    c.set('tailscaleAccess', binding.access)
    c.set('tailscaleSandboxAccess', binding.sandboxAccess)
    c.set('tailscaleBindingAuth', {
      clientId: binding.clientId,
      encryptedClientSecret: binding.encryptedClientSecret,
      federation: binding.federation,
    })
    await next()
  }
}

export function requireTailscaleMemberAccess(): MiddlewareHandler<{
  Variables: TailscaleClientVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('tailscaleAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'tailscale_client_access_denied',
        'You are not allowed to use this Tailscale OAuth client binding',
      )
    }
    await next()
  }
}

export function requireLinearWorkspace(): MiddlewareHandler<{
  Variables: LinearWorkspaceVariables
}> {
  return async (c, next) => {
    const param = c.req.param('bindingId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_binding_id', 'bindingId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findLinearWorkspace(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'linear_workspace_not_bound',
        `Linear workspace ${param} is not bound to this team`,
      )
    }
    c.set('linearWorkspaceId', param)
    c.set('linearBinding', binding)
    c.set('linearLabel', binding.label)
    c.set('linearAccess', binding.access)
    await next()
  }
}

export function requireLinearMemberAccess(): MiddlewareHandler<{
  Variables: LinearWorkspaceVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('linearAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'linear_workspace_access_denied',
        'You are not allowed to use this Linear workspace binding',
      )
    }
    await next()
  }
}

export function requireJiraSite(): MiddlewareHandler<{
  Variables: JiraSiteVariables
}> {
  return async (c, next) => {
    const param = c.req.param('bindingId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_binding_id', 'bindingId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findJiraSite(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(404, 'jira_site_not_bound', `Jira site ${param} is not bound to this team`)
    }
    c.set('jiraSiteId', param)
    c.set('jiraBinding', binding)
    c.set('jiraLabel', binding.label)
    c.set('jiraAccess', binding.access)
    await next()
  }
}

export function requireJiraMemberAccess(): MiddlewareHandler<{
  Variables: JiraSiteVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('jiraAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'jira_site_access_denied',
        'You are not allowed to use this Jira site binding',
      )
    }
    await next()
  }
}

export function requireAsanaAccount(): MiddlewareHandler<{
  Variables: AsanaAccountVariables
}> {
  return async (c, next) => {
    const param = c.req.param('bindingId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_binding_id', 'bindingId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findAsanaAccount(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'asana_account_not_bound',
        `Asana account ${param} is not bound to this team`,
      )
    }
    c.set('asanaAccountId', param)
    c.set('asanaBinding', binding)
    c.set('asanaLabel', binding.label)
    c.set('asanaAccess', binding.access)
    await next()
  }
}

export function requireAsanaMemberAccess(): MiddlewareHandler<{
  Variables: AsanaAccountVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('asanaAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'asana_account_access_denied',
        'You are not allowed to use this Asana account binding',
      )
    }
    await next()
  }
}

export function requireSentryAccount(): MiddlewareHandler<{
  Variables: SentryAccountVariables
}> {
  return async (c, next) => {
    const param = c.req.param('bindingId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_binding_id', 'bindingId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findSentryAccount(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'sentry_account_not_bound',
        `Sentry account ${param} is not bound to this team`,
      )
    }
    c.set('sentryAccountId', param)
    c.set('sentryBinding', binding)
    c.set('sentryLabel', binding.label)
    c.set('sentryAccess', binding.access)
    await next()
  }
}

export function requireSentryMemberAccess(): MiddlewareHandler<{
  Variables: SentryAccountVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('sentryAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'sentry_account_access_denied',
        'You are not allowed to use this Sentry account binding',
      )
    }
    await next()
  }
}
