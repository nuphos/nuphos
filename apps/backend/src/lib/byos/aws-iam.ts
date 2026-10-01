import {
  GetPolicyCommand,
  GetPolicyVersionCommand,
  GetRoleCommand,
  GetRolePolicyCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
} from '@aws-sdk/client-iam'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'

import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector } from './aws'
import { computeAwsSelfCapabilities } from './aws-iam-capabilities'
import {
  decodePolicyDocument,
  extractRoleNameFromArn,
  parseAwsList,
  summarizeError,
} from './aws-iam-policy'

import type { AwsIamPermissions, IamPolicy, IamStatement } from './aws-iam-policy'

export type { AwsIamPermissions, IamPolicy, IamStatement, SelfCapabilities } from './aws-iam-policy'

export async function getAwsIamPermissions(roleArn: string): Promise<AwsIamPermissions> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) {
    throw new Error(`Invalid roleArn (cannot extract account ID): ${roleArn}`)
  }
  const roleName = extractRoleNameFromArn(roleArn)

  if (!roleName) {
    throw new Error(`Invalid roleArn (cannot extract role name): ${roleArn}`)
  }

  // AssumeRole is the first thing that can fail (e.g. customer changed the
  // trust policy, removed the role, or revoked sts:AssumeRole). The whole
  // point of this page is to help that user diagnose the gap — return the
  // partial-results shape with a warning instead of bubbling a 500.
  let temp: Awaited<ReturnType<typeof assumeRoleAsConnector>>

  try {
    temp = await assumeRoleAsConnector(roleArn)
  } catch (e) {
    return {
      accountId,
      roleArn,
      roleName,
      trustPolicySummary: null,
      callerArn: null,
      callerUserId: null,
      warnings: [
        summarizeError(
          'AssumeRole failed — Nuphos connector cannot reach this role (check trust policy and sts:AssumeRole)',
          e,
        ),
      ],
      policies: [],
      selfCapabilities: {
        canRead: false,
        canWrite: false,
        inferred: true,
        readReason: 'AssumeRole failed, so we could not check what this role can read.',
        writeReason: 'AssumeRole failed, so we could not check what this role can modify.',
      },
    }
  }
  const region = 'us-east-1'
  const iam = new IAMClient({ region, credentials: temp })
  const sts = new STSClient({ region, credentials: temp })

  const warnings: string[] = []

  let callerArn: string | null = null
  let callerUserId: string | null = null

  try {
    const out = await sts.send(new GetCallerIdentityCommand({}))

    callerArn = out.Arn ?? null
    callerUserId = out.UserId ?? null
  } catch (e) {
    warnings.push(summarizeError('GetCallerIdentity failed', e))
  }

  let trustPolicySummary: string | null = null

  try {
    const role = await iam.send(new GetRoleCommand({ RoleName: roleName }))
    const doc = role.Role?.AssumeRolePolicyDocument

    if (doc) {
      try {
        const decoded = decodeURIComponent(doc)
        const parsed = JSON.parse(decoded)

        trustPolicySummary = JSON.stringify(parsed, null, 2)
      } catch {
        trustPolicySummary = doc
      }
    }
  } catch (e) {
    warnings.push(summarizeError('GetRole failed', e))
  }

  const policies: IamPolicy[] = []

  // Inline policies
  try {
    const inlineList = await iam.send(new ListRolePoliciesCommand({ RoleName: roleName }))
    const inlineNames = parseAwsList(inlineList.PolicyNames)
    const inlineDocs = await Promise.all(
      inlineNames.map(async (name) => {
        try {
          const out = await iam.send(
            new GetRolePolicyCommand({ RoleName: roleName, PolicyName: name }),
          )

          return {
            name,
            statements: decodePolicyDocument(out.PolicyDocument),
          }
        } catch (e) {
          warnings.push(summarizeError(`GetRolePolicy(${name}) failed`, e))

          return { name, statements: [] }
        }
      }),
    )

    for (const p of inlineDocs) {
      policies.push({
        name: p.name,
        kind: 'inline',
        statements: p.statements,
      })
    }
  } catch (e) {
    warnings.push(summarizeError('ListRolePolicies failed', e))
  }

  // Attached managed policies
  try {
    const managedList = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }))
    const attached = parseAwsList(managedList.AttachedPolicies)
    const managedDocs = await Promise.all(
      attached.map(async (entry) => {
        const arn = entry.PolicyArn
        const name = entry.PolicyName ?? arn ?? '(unknown)'

        if (!arn) {
          return {
            name,
            kind: 'managed' as const,
            statements: [] as IamStatement[],
          }
        }
        const awsManaged = arn.startsWith('arn:aws:iam::aws:')
        let versionId: string | undefined
        let updatedAt: string | undefined
        let statements: IamStatement[] = []

        try {
          const meta = await iam.send(new GetPolicyCommand({ PolicyArn: arn }))

          versionId = meta.Policy?.DefaultVersionId ?? undefined
          updatedAt = meta.Policy?.UpdateDate
            ? new Date(meta.Policy.UpdateDate).toISOString()
            : undefined
        } catch (e) {
          warnings.push(summarizeError(`GetPolicy(${name}) failed`, e))
        }
        if (versionId) {
          try {
            const ver = await iam.send(
              new GetPolicyVersionCommand({ PolicyArn: arn, VersionId: versionId }),
            )

            statements = decodePolicyDocument(ver.PolicyVersion?.Document)
          } catch (e) {
            warnings.push(summarizeError(`GetPolicyVersion(${name}) failed`, e))
          }
        }

        return {
          name,
          kind: 'managed' as const,
          arn,
          awsManaged,
          versionId,
          updatedAt,
          statements,
        }
      }),
    )

    policies.push(...managedDocs)
  } catch (e) {
    warnings.push(summarizeError('ListAttachedRolePolicies failed', e))
  }

  const selfCapabilities = await computeAwsSelfCapabilities({
    iam,
    roleArn,
    policies,
    // If any read API above succeeded we got *some* policy data back,
    // which is itself proof the role can introspect itself.
    readSucceeded: policies.length > 0,
  })

  return {
    accountId,
    roleArn,
    roleName,
    trustPolicySummary,
    callerArn,
    callerUserId,
    warnings,
    policies,
    selfCapabilities,
  }
}
