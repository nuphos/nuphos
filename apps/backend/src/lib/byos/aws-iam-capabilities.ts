import { SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam'

import type { IamPolicy, SelfCapabilities } from './aws-iam-policy'
import type { IAMClient } from '@aws-sdk/client-iam'

// IAM actions that would let the role rewrite or delete itself. Used both
// for SimulatePrincipalPolicy (authoritative) and statement-scanning fallback.
const SELF_WRITE_ACTIONS = [
  'iam:PutRolePolicy',
  'iam:DeleteRolePolicy',
  'iam:AttachRolePolicy',
  'iam:DetachRolePolicy',
  'iam:UpdateAssumeRolePolicy',
  'iam:DeleteRole',
] as const

const SELF_READ_ACTIONS = [
  'iam:GetRole',
  'iam:ListRolePolicies',
  'iam:ListAttachedRolePolicies',
  'iam:GetRolePolicy',
  'iam:GetPolicy',
  'iam:GetPolicyVersion',
] as const

function actionPatternMatches(pattern: string, action: string): boolean {
  // IAM uses '*' as wildcard within action names; convert to regex.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')

  return new RegExp(`^${escaped}$`, 'i').test(action)
}

function resourcePatternMatches(pattern: string, roleArn: string): boolean {
  if (pattern === '*') return true
  // Roles in this account: arn:aws:iam::ACCT:role/* — treat any iam:role
  // pattern that wildcards the role name as a potential self-match. Be
  // conservative: only call it a match if it could resolve to this role.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')

  return new RegExp(`^${escaped}$`).test(roleArn)
}

function statementsImplyWriteOnSelf(policies: IamPolicy[], roleArn: string): boolean {
  for (const policy of policies) {
    for (const stmt of policy.statements) {
      if (stmt.effect !== 'Allow') continue
      const actionList = stmt.actions.length > 0 ? stmt.actions : []
      const resourceList = stmt.resources.length > 0 ? stmt.resources : []
      const hasMatchingAction = actionList.some((a) =>
        SELF_WRITE_ACTIONS.some((w) => actionPatternMatches(a, w)),
      )
      const hasMatchingResource = resourceList.some((r) => resourcePatternMatches(r, roleArn))

      if (hasMatchingAction && hasMatchingResource) return true
    }
  }

  return false
}

export async function computeAwsSelfCapabilities({
  iam,
  roleArn,
  policies,
  readSucceeded,
}: {
  iam: IAMClient
  roleArn: string
  policies: IamPolicy[]
  readSucceeded: boolean
}): Promise<SelfCapabilities> {
  // Authoritative path: SimulatePrincipalPolicy. Tells us exactly which of a
  // list of actions the role is allowed to take on its own ARN. Falls back
  // to inferring from the policy documents we already fetched.
  try {
    const out = await iam.send(
      new SimulatePrincipalPolicyCommand({
        PolicySourceArn: roleArn,
        ActionNames: [...SELF_READ_ACTIONS, ...SELF_WRITE_ACTIONS],
        ResourceArns: [roleArn],
      }),
    )
    const allowedSet = new Set(
      (out.EvaluationResults ?? [])
        .filter((r) => r.EvalDecision === 'allowed')
        .map((r) => r.EvalActionName)
        .filter((a): a is string => !!a),
    )
    const canRead = SELF_READ_ACTIONS.some((a) => allowedSet.has(a))
    const canWrite = SELF_WRITE_ACTIONS.some((a) => allowedSet.has(a))

    return {
      canRead,
      canWrite,
      inferred: false,
      readReason: canRead
        ? `Allowed to call ${SELF_READ_ACTIONS.filter((a) => allowedSet.has(a)).join(', ')} on itself.`
        : 'Simulator reports the role cannot read its own IAM metadata.',
      writeReason: canWrite
        ? `Allowed to call ${SELF_WRITE_ACTIONS.filter((a) => allowedSet.has(a)).join(', ')} on itself — you can adjust Nuphos's scope from this role without re-binding.`
        : "This role cannot rewrite its own IAM policies. To change Nuphos's scope you'll need a separately-credentialed IAM admin.",
    }
  } catch {
    // No iam:SimulatePrincipalPolicy. Fall back to scanning what we read.
    const canRead = readSucceeded
    const canWrite = statementsImplyWriteOnSelf(policies, roleArn)

    return {
      canRead,
      canWrite,
      inferred: true,
      readReason: canRead
        ? "We successfully read this role's policies via the IAM API."
        : "Could not read this role's policies — the role lacks the iam:Get*/List* actions on itself.",
      writeReason: canWrite
        ? 'Inferred from policy documents: an Allow statement covers iam write actions on this role. Could not run iam:SimulatePrincipalPolicy to confirm.'
        : 'No Allow statement in the fetched policies grants iam write actions on this role. Could not run iam:SimulatePrincipalPolicy to confirm.',
    }
  }
}
