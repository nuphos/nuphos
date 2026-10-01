import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import { listAwsBindingsForAccount, listGcpBindingsForProject } from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type { AwsAccountVariables, GcpProjectVariables } from '@/middleware/auth/types'
import type { AwsRoleBinding, GcpServiceAccountBinding } from '@/models'
import type { MiddlewareHandler } from 'hono'

export function requireAwsAccount(): MiddlewareHandler<{ Variables: AwsAccountVariables }> {
  return async (c, next) => {
    const accountId = c.req.param('accountId')

    if (!accountId || !/^\d{12}$/.test(accountId)) {
      throw new AppError(400, 'invalid_account_id', 'accountId must be a 12-digit AWS account ID')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const bindings = await listAwsBindingsForAccount(teamId, accountId)

    if (bindings.length === 0) {
      throw new AppError(
        404,
        'account_not_bound',
        `AWS account ${accountId} is not bound to this team`,
      )
    }
    const roleId = c.req.query('roleId')
    // When no role is named, only ever default to an operational binding — never
    // a permission-admin (human-only, IAM-escalation) role, even if it's the
    // only one bound. Callers that legitimately operate on a permission-admin
    // role (managing its access, deleting it) must name it explicitly.
    let binding: AwsRoleBinding | null

    if (roleId) {
      binding = findAwsBindingByQueryId(bindings, roleId)
      if (!binding) {
        throw new AppError(404, 'role_not_bound', `AWS role ${roleId} is not bound to this account`)
      }
    } else {
      binding = bindings.find((b) => b.purpose !== 'permission-admin') ?? null
      if (!binding) {
        throw new AppError(
          404,
          'no_operational_role',
          `AWS account ${accountId} has no operational role bound; a permission-admin role cannot be selected implicitly`,
        )
      }
    }
    c.set('accountId', accountId)
    c.set('awsBindings', bindings)
    c.set('awsRoleArn', binding.roleArn)
    c.set('awsBinding', binding)
    c.set('awsBindingExplicit', Boolean(roleId))
    await next()
  }
}

export function requireAwsMemberAccess(): MiddlewareHandler<{ Variables: AwsAccountVariables }> {
  return async (c, next) => {
    const binding = selectAwsBindingForAccess(c)

    if (!canUseAllowList(binding.access?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'aws_account_access_denied',
        'You are not allowed to use this AWS account binding',
      )
    }
    await next()
  }
}

export function requireGcpProject(): MiddlewareHandler<{ Variables: GcpProjectVariables }> {
  return async (c, next) => {
    const projectId = c.req.param('projectId')

    if (!projectId) {
      throw new AppError(400, 'invalid_request', 'Missing projectId param')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const bindings = await listGcpBindingsForProject(teamId, projectId)

    if (bindings.length === 0) {
      throw new AppError(
        404,
        'project_not_bound',
        `GCP project ${projectId} is not bound to this team`,
      )
    }
    const serviceAccountId = c.req.query('serviceAccountId')
    // When no SA is named, only ever default to an operational binding — never a
    // permission-admin (human-only, IAM-escalation) SA, even if it's the only
    // one bound. Callers that legitimately operate on a permission-admin SA
    // (managing its access, deleting it) must name it explicitly.
    let binding: GcpServiceAccountBinding | null

    if (serviceAccountId) {
      binding = findGcpBindingByQueryId(bindings, serviceAccountId)
      if (!binding) {
        throw new AppError(
          404,
          'service_account_not_bound',
          `GCP service account ${serviceAccountId} is not bound to this project`,
        )
      }
    } else {
      binding = bindings.find((b) => b.purpose !== 'permission-admin') ?? null
      if (!binding) {
        throw new AppError(
          404,
          'no_operational_service_account',
          `Project ${projectId} has no operational service account bound; a permission-admin SA cannot be selected implicitly`,
        )
      }
    }
    c.set('projectId', projectId)
    c.set('gcpBindings', bindings)
    c.set('serviceAccountEmail', binding.serviceAccountEmail)
    c.set('gcpBinding', binding)
    c.set('gcpBindingExplicit', Boolean(serviceAccountId))
    await next()
  }
}

export function requireGcpMemberAccess(): MiddlewareHandler<{ Variables: GcpProjectVariables }> {
  return async (c, next) => {
    const binding = selectGcpBindingForAccess(c)

    if (!canUseAllowList(binding.access?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'gcp_project_access_denied',
        'You are not allowed to use this GCP project binding',
      )
    }
    await next()
  }
}

function findAwsBindingByQueryId(
  bindings: AwsRoleBinding[],
  roleId: string,
): AwsRoleBinding | null {
  if (!ObjectId.isValid(roleId)) {
    throw new AppError(400, 'invalid_role_id', `Invalid roleId: ${roleId}`)
  }

  return bindings.find((b) => b.id.equals(roleId)) ?? null
}

function selectAwsBindingForAccess(
  c: Parameters<MiddlewareHandler<{ Variables: AwsAccountVariables }>>[0],
): AwsRoleBinding {
  const selected = c.get('awsBinding')
  const userId = c.get('userId')

  if (c.get('awsBindingExplicit')) {
    return selected
  }
  const accessible = c
    .get('awsBindings')
    .find(
      (b) => b.purpose !== 'permission-admin' && canUseAllowList(b.access?.memberAllowList, userId),
    )

  if (!accessible) return selected
  c.set('awsRoleArn', accessible.roleArn)
  c.set('awsBinding', accessible)

  return accessible
}

function findGcpBindingByQueryId(
  bindings: GcpServiceAccountBinding[],
  serviceAccountId: string,
): GcpServiceAccountBinding | null {
  if (!ObjectId.isValid(serviceAccountId)) {
    throw new AppError(
      400,
      'invalid_service_account_id',
      `Invalid serviceAccountId: ${serviceAccountId}`,
    )
  }

  return bindings.find((b) => b.id.equals(serviceAccountId)) ?? null
}

function selectGcpBindingForAccess(
  c: Parameters<MiddlewareHandler<{ Variables: GcpProjectVariables }>>[0],
): GcpServiceAccountBinding {
  const selected = c.get('gcpBinding')
  const userId = c.get('userId')

  if (c.get('gcpBindingExplicit')) {
    return selected
  }
  const accessible = c
    .get('gcpBindings')
    .find(
      (b) => b.purpose !== 'permission-admin' && canUseAllowList(b.access?.memberAllowList, userId),
    )

  if (!accessible) return selected
  c.set('serviceAccountEmail', accessible.serviceAccountEmail)
  c.set('gcpBinding', accessible)

  return accessible
}
