import { ObjectId } from 'mongodb'

import {
  findGrafanaInstance,
  findGithubInstallation,
  findGitlabBinding,
  findCloudflareAccount,
  findZeaburProviderByZeaburId,
} from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type {
  CloudflareAccountVariables,
  GithubInstallationVariables,
  GitlabBindingVariables,
  GrafanaInstanceVariables,
  ZeaburProviderVariables,
} from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

export function requireGrafanaInstance(): MiddlewareHandler<{
  Variables: GrafanaInstanceVariables
}> {
  return async (c, next) => {
    const instanceIdParam = c.req.param('instanceId')

    if (!instanceIdParam || !ObjectId.isValid(instanceIdParam)) {
      throw new AppError(400, 'invalid_id', `Invalid instanceId: ${String(instanceIdParam)}`)
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findGrafanaInstance(teamId, new ObjectId(instanceIdParam))

    if (!binding) {
      throw new AppError(
        404,
        'grafana_instance_not_bound',
        `Grafana instance ${instanceIdParam} is not bound to this team`,
      )
    }
    c.set('grafanaInstanceId', instanceIdParam)
    c.set('grafanaUrl', binding.grafanaUrl)
    c.set('grafanaSaToken', binding.saToken)
    c.set('grafanaName', binding.name)
    await next()
  }
}

export function requireGithubInstallation(): MiddlewareHandler<{
  Variables: GithubInstallationVariables
}> {
  return async (c, next) => {
    const param = c.req.param('installationId')

    if (!param || !/^\d+$/.test(param)) {
      throw new AppError(400, 'invalid_id', `Invalid installationId: ${String(param)}`)
    }
    const installationId = Number(param)

    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new AppError(400, 'invalid_id', `Invalid installationId: ${param}`)
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findGithubInstallation(teamId, installationId)

    if (!binding) {
      throw new AppError(
        404,
        'github_installation_not_bound',
        `GitHub installation ${String(installationId)} is not bound to this team`,
      )
    }
    c.set('githubInstallationId', installationId)
    c.set('githubAccountLogin', binding.accountLogin)
    c.set('githubAccountType', binding.accountType)
    await next()
  }
}

export function requireGitlabBinding(): MiddlewareHandler<{
  Variables: GitlabBindingVariables
}> {
  return async (c, next) => {
    const param = c.req.param('bindingId')

    if (!param || !ObjectId.isValid(param)) {
      throw new AppError(400, 'invalid_id', `Invalid bindingId: ${String(param)}`)
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findGitlabBinding(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'gitlab_binding_not_bound',
        `GitLab binding ${param} is not bound to this team`,
      )
    }
    c.set('gitlabBindingId', param)
    c.set('gitlabBinding', binding)
    await next()
  }
}

export function requireZeaburProvider(): MiddlewareHandler<{
  Variables: ZeaburProviderVariables
}> {
  return async (c, next) => {
    const zeaburId = c.req.param('zeaburId')?.trim()

    if (!zeaburId) {
      throw new AppError(400, 'invalid_zeabur_id', 'zeaburId is required')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findZeaburProviderByZeaburId(teamId, zeaburId)
    const identity = binding?.identities?.find((item) => item.zeaburId === zeaburId)

    if (!binding || !identity) {
      throw new AppError(
        404,
        'zeabur_identity_not_bound',
        `Zeabur identity ${zeaburId} is not bound to this team`,
      )
    }
    c.set('zeaburId', zeaburId)
    c.set('zeaburKind', identity.kind)
    c.set('zeaburName', identity.name)
    c.set('zeaburEncryptedToken', binding.encryptedToken)
    await next()
  }
}

export function requireCloudflareAccount(): MiddlewareHandler<{
  Variables: CloudflareAccountVariables
}> {
  return async (c, next) => {
    const accountId = c.req.param('accountId')

    if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
      throw new AppError(
        400,
        'invalid_account_id',
        'accountId must be a 32-character Cloudflare account ID',
      )
    }
    const normalizedAccountId = accountId.toLowerCase()
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findCloudflareAccount(teamId, normalizedAccountId)

    if (!binding) {
      throw new AppError(
        404,
        'cloudflare_account_not_bound',
        `Cloudflare account ${normalizedAccountId} is not bound to this team`,
      )
    }
    c.set('cloudflareAccountId', normalizedAccountId)
    c.set('cloudflareAccountName', binding.accountName)
    c.set('cloudflareBinding', binding)
    c.set('cloudflareEncryptedApiKey', binding.encryptedApiKey ?? null)
    c.set('cloudflareR2S3', binding.r2S3 ?? null)
    await next()
  }
}
