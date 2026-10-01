import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import {
  findLinodeAccount,
  findHetznerAccount,
  findVantaIntegration,
  findSecureframeIntegration,
  findSonarqubeIntegration,
} from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type {
  HetznerAccountVariables,
  LinodeAccountVariables,
  SecureframeIntegrationVariables,
  SonarqubeIntegrationVariables,
  VantaIntegrationVariables,
} from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

export function requireLinodeAccount(): MiddlewareHandler<{
  Variables: LinodeAccountVariables
}> {
  return async (c, next) => {
    const param = c.req.param('accountId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_account_id', 'accountId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findLinodeAccount(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'linode_account_not_bound',
        `Linode account ${param} is not bound to this team`,
      )
    }
    c.set('linodeAccountId', param)
    c.set('linodeAccountLabel', binding.label)
    c.set('linodeAccess', binding.access)
    c.set('linodeEncryptedToken', binding.encryptedToken)
    await next()
  }
}

export function requireLinodeMemberAccess(): MiddlewareHandler<{
  Variables: LinodeAccountVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('linodeAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'linode_account_access_denied',
        'You are not allowed to use this Linode account binding',
      )
    }
    await next()
  }
}

export function requireHetznerAccount(): MiddlewareHandler<{
  Variables: HetznerAccountVariables
}> {
  return async (c, next) => {
    const param = c.req.param('accountId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_account_id', 'accountId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findHetznerAccount(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'hetzner_account_not_bound',
        `Hetzner account ${param} is not bound to this team`,
      )
    }
    c.set('hetznerAccountId', param)
    c.set('hetznerAccountLabel', binding.label)
    c.set('hetznerAccess', binding.access)
    c.set('hetznerEncryptedToken', binding.encryptedToken)
    await next()
  }
}

export function requireHetznerMemberAccess(): MiddlewareHandler<{
  Variables: HetznerAccountVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('hetznerAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'hetzner_account_access_denied',
        'You are not allowed to use this Hetzner account binding',
      )
    }
    await next()
  }
}

export function requireVantaIntegration(): MiddlewareHandler<{
  Variables: VantaIntegrationVariables
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
    const binding = await findVantaIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'vanta_integration_not_bound',
        `Vanta integration ${param} is not bound to this team`,
      )
    }
    c.set('vantaIntegrationId', param)
    c.set('vantaIntegrationLabel', binding.label)
    c.set('vantaAccess', binding.access)
    c.set('vantaBinding', binding)
    await next()
  }
}

export function requireVantaMemberAccess(): MiddlewareHandler<{
  Variables: VantaIntegrationVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('vantaAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'vanta_integration_access_denied',
        'You are not allowed to use this Vanta integration binding',
      )
    }
    await next()
  }
}

export function requireSecureframeIntegration(): MiddlewareHandler<{
  Variables: SecureframeIntegrationVariables
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
    const binding = await findSecureframeIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'secureframe_integration_not_bound',
        `Secureframe integration ${param} is not bound to this team`,
      )
    }
    c.set('secureframeIntegrationId', param)
    c.set('secureframeIntegrationLabel', binding.label)
    c.set('secureframeAccess', binding.access)
    c.set('secureframeBinding', binding)
    await next()
  }
}

export function requireSecureframeMemberAccess(): MiddlewareHandler<{
  Variables: SecureframeIntegrationVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('secureframeAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'secureframe_integration_access_denied',
        'You are not allowed to use this Secureframe integration binding',
      )
    }
    await next()
  }
}

export function requireSonarqubeIntegration(): MiddlewareHandler<{
  Variables: SonarqubeIntegrationVariables
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
    const binding = await findSonarqubeIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'sonarqube_integration_not_bound',
        `SonarQube integration ${param} is not bound to this team`,
      )
    }
    c.set('sonarqubeIntegrationId', param)
    c.set('sonarqubeIntegrationLabel', binding.label)
    c.set('sonarqubeAccess', binding.access)
    c.set('sonarqubeBinding', binding)
    await next()
  }
}

export function requireSonarqubeMemberAccess(): MiddlewareHandler<{
  Variables: SonarqubeIntegrationVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('sonarqubeAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'sonarqube_integration_access_denied',
        'You are not allowed to use this SonarQube integration binding',
      )
    }
    await next()
  }
}
