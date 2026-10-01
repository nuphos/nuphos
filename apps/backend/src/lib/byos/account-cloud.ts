import { teamByosBindings } from '@/models'

import type { AwsRoleBinding, AzureAccountBinding, GcpServiceAccountBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export function extractAwsAccountId(roleArn: string): string | null {
  const m = /^arn:aws:iam::(\d{12}):role\//.exec(roleArn)

  return m ? m[1]! : null
}

export async function findAwsBinding(
  teamId: ObjectId,
  accountId: string,
): Promise<AwsRoleBinding | null> {
  const bindings = await listAwsBindingsForAccount(teamId, accountId)

  return bindings[0] ?? null
}

export async function listAwsBindingsForAccount(
  teamId: ObjectId,
  accountId: string,
): Promise<AwsRoleBinding[]> {
  const doc = await teamByosBindings().findOne({ _id: teamId }, { projection: { awsRoles: 1 } })

  return (doc?.awsRoles ?? []).filter((b) => extractAwsAccountId(b.roleArn) === accountId)
}

/**
 * Reverse lookup for credential minting: which team's OIDC identity should be
 * used to assume this role. The bind route enforces that a role ARN is bound
 * by at most one team (409 role_bound_elsewhere), so the first match is the
 * only match.
 */
export async function findAwsOidcTeamForRoleArn(roleArn: string): Promise<ObjectId | null> {
  const doc = await teamByosBindings().findOne(
    { awsRoles: { $elemMatch: { roleArn } } },
    { projection: { _id: 1 } },
  )

  return doc?._id ?? null
}

export async function findAwsBindingByRoleArn(
  teamId: ObjectId,
  roleArn: string,
): Promise<AwsRoleBinding | null> {
  const doc = await teamByosBindings().findOne({ _id: teamId }, { projection: { awsRoles: 1 } })

  return (doc?.awsRoles ?? []).find((b) => b.roleArn === roleArn) ?? null
}

export async function findGcpBinding(
  teamId: ObjectId,
  projectId: string,
): Promise<GcpServiceAccountBinding | null> {
  const bindings = await listGcpBindingsForProject(teamId, projectId)

  return bindings[0] ?? null
}

export async function listGcpBindingsForProject(
  teamId: ObjectId,
  projectId: string,
): Promise<GcpServiceAccountBinding[]> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gcpServiceAccounts: 1 } },
  )

  return (doc?.gcpServiceAccounts ?? []).filter((b) => b.projectId === projectId)
}

/** All Azure bindings on a subscription — an operational binding plus any
 *  permission-admin (break-glass) binding governing the same subscription. */
export async function listAzureBindingsForSubscription(
  teamId: ObjectId,
  subscriptionId: string,
): Promise<AzureAccountBinding[]> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { azureAccounts: 1 } },
  )

  return (doc?.azureAccounts ?? []).filter((b) => b.subscriptionId === subscriptionId)
}

export async function findGcpBindingByServiceAccount(
  teamId: ObjectId,
  projectId: string,
  serviceAccountEmail: string,
): Promise<GcpServiceAccountBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { gcpServiceAccounts: 1 } },
  )

  return (
    (doc?.gcpServiceAccounts ?? []).find(
      (b) => b.projectId === projectId && b.serviceAccountEmail === serviceAccountEmail,
    ) ?? null
  )
}
