import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import {
  findBetterStackIntegration,
  findUptimeKumaInstance,
  findNotionIntegration,
  findUpstashAccount,
  findResendIntegration,
} from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type {
  BetterStackIntegrationVariables,
  NotionIntegrationVariables,
  ResendIntegrationVariables,
  UpstashAccountVariables,
  UptimeKumaInstanceVariables,
} from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

export function requireResendIntegration(): MiddlewareHandler<{
  Variables: ResendIntegrationVariables
}> {
  return async (c, next) => {
    const param = c.req.param('integrationId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(
        400,
        'invalid_integration_id',
        'integrationId must be a 24-character hex ObjectId',
      )
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findResendIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'resend_integration_not_bound',
        `Resend integration ${param} is not bound to this team`,
      )
    }
    c.set('resendIntegrationId', param)
    c.set('resendIntegrationLabel', binding.label)
    c.set('resendAccess', binding.access)
    c.set('resendBinding', binding)
    await next()
  }
}

export function requireResendMemberAccess(): MiddlewareHandler<{
  Variables: ResendIntegrationVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('resendAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'resend_integration_access_denied',
        'You are not allowed to use this Resend integration binding',
      )
    }
    await next()
  }
}

export function requireNotionIntegration(): MiddlewareHandler<{
  Variables: NotionIntegrationVariables
}> {
  return async (c, next) => {
    const param = c.req.param('integrationId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(
        400,
        'invalid_integration_id',
        'integrationId must be a 24-character hex ObjectId',
      )
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findNotionIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'notion_integration_not_bound',
        `Notion integration ${param} is not bound to this team`,
      )
    }
    c.set('notionIntegrationId', param)
    c.set('notionIntegrationLabel', binding.label)
    c.set('notionAccess', binding.access)
    c.set('notionBinding', binding)
    await next()
  }
}

export function requireNotionMemberAccess(): MiddlewareHandler<{
  Variables: NotionIntegrationVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('notionAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'notion_integration_access_denied',
        'You are not allowed to use this Notion integration binding',
      )
    }
    await next()
  }
}

export function requireUpstashAccount(): MiddlewareHandler<{
  Variables: UpstashAccountVariables
}> {
  return async (c, next) => {
    const param = c.req.param('accountId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_account_id', 'accountId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findUpstashAccount(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'upstash_account_not_bound',
        `Upstash account ${param} is not bound to this team`,
      )
    }
    c.set('upstashAccountId', param)
    c.set('upstashAccountLabel', binding.label)
    c.set('upstashAccess', binding.access)
    c.set('upstashBinding', binding)
    await next()
  }
}

export function requireUpstashMemberAccess(): MiddlewareHandler<{
  Variables: UpstashAccountVariables
}> {
  return async (c, next) => {
    // Admins bypass the allow-list (same rule as the Tencent/Aliyun/Volcengine
    // bindings). Upstash defaults to binder-only rather than every member, so
    // without this an admin couldn't administer a binding they didn't create.
    if (
      c.get('teamRole') !== 'ADMINISTRATOR' &&
      !canUseAllowList(c.get('upstashAccess')?.memberAllowList, c.get('userId'))
    ) {
      throw new AppError(
        403,
        'upstash_account_access_denied',
        'You are not allowed to use this Upstash account binding',
      )
    }
    await next()
  }
}

export function requireBetterStackIntegration(): MiddlewareHandler<{
  Variables: BetterStackIntegrationVariables
}> {
  return async (c, next) => {
    const param = c.req.param('integrationId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(
        400,
        'invalid_integration_id',
        'integrationId must be a 24-character hex ObjectId',
      )
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findBetterStackIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'betterstack_integration_not_bound',
        `Better Stack integration ${param} is not bound to this team`,
      )
    }
    c.set('betterStackIntegrationId', param)
    c.set('betterStackBinding', binding)
    c.set('betterStackLabel', binding.label)
    c.set('betterStackAccess', binding.access)
    c.set('betterStackEncryptedUptimeApiToken', binding.encryptedUptimeApiToken)
    c.set('betterStackEncryptedTelemetryApiToken', binding.encryptedTelemetryApiToken)
    await next()
  }
}

export function requireBetterStackMemberAccess(): MiddlewareHandler<{
  Variables: BetterStackIntegrationVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('betterStackAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'betterstack_integration_access_denied',
        'You are not allowed to use this Better Stack integration',
      )
    }
    await next()
  }
}

export function requireUptimeKumaInstance(): MiddlewareHandler<{
  Variables: UptimeKumaInstanceVariables
}> {
  return async (c, next) => {
    const param = c.req.param('instanceId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(
        400,
        'invalid_instance_id',
        'instanceId must be a 24-character hex ObjectId',
      )
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findUptimeKumaInstance(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'uptime_kuma_instance_not_bound',
        `Uptime Kuma instance ${param} is not bound to this team`,
      )
    }
    c.set('uptimeKumaInstanceId', param)
    c.set('uptimeKumaBinding', binding)
    c.set('uptimeKumaLabel', binding.label)
    c.set('uptimeKumaAccess', binding.access)
    await next()
  }
}

export function requireUptimeKumaMemberAccess(): MiddlewareHandler<{
  Variables: UptimeKumaInstanceVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('uptimeKumaAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'uptime_kuma_instance_access_denied',
        'You are not allowed to use this Uptime Kuma instance',
      )
    }
    await next()
  }
}
