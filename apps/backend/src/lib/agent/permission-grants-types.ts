import type { ObjectId as ObjectIdType } from 'mongodb'

/**
 * A permission-update proposal the Nuphos agent creates during a session when it
 * hits (or anticipates) a permission wall. It is NEVER auto-applied: a team
 * administrator reviews the exact diff and approves it, at which point the
 * backend executes the change deterministically via a permission-admin binding
 * (the agent never performs the IAM write itself).
 *
 * The change kinds are grant/revoke of a provider-vetted permission bundle
 * (managed policy / predefined role / built-in role); create-custom — an
 * agent-drafted least-privilege permission set created AND granted to the
 * target in one action; and, on AWS, create-custom-iam and create-principal,
 * which additionally run under a permissions boundary an administrator
 * registered ahead of time.
 */
export type PermissionGrantStatus = 'proposed' | 'rejected' | 'executing' | 'executed' | 'failed'

export type PermissionChangeAction =
  | 'grant'
  | 'revoke'
  | 'create-custom'
  /**
   * AWS only. Like create-custom, but the drafted policy may carry `iam:`
   * actions for managing sub-identities. Admissible only under a permissions
   * boundary an administrator registered on the target in advance, which the
   * change must name in `permissionsBoundaryArn`. The draft chooses the shape;
   * a human chose the ceiling.
   */
  | 'create-custom-iam'
  /**
   * AWS only. Creates a new IAM user capped by a registered permissions
   * boundary and puts an inline policy on it. GCP and Azure's create-custom
   * really do create a principal-bearing role; AWS's did not, so a wall that
   * needed a fresh scoped identity had nowhere to go. No credential of any kind
   * is minted for the new user.
   */
  | 'create-principal'

/**
 * One atomic change inside a proposal. A proposal batches one or more of these,
 * so the user can grant several / revoke several / mix action kinds and approve
 * them all with a single review.
 */
export type PermissionGrantChange = {
  action: PermissionChangeAction
  /** Human label, e.g. "AmazonS3ReadOnlyAccess" or "roles/storage.objectViewer". */
  grantLabel: string
  // aws
  /** Target principal ARN — a bound role, or a registered managed user/group/role.
   *  `targetRoleArn` is the pre-user/group spelling, still read by
   *  changeTargetPrincipalArn() for proposals drafted before this existed. */
  targetPrincipalArn?: string
  targetRoleArn?: string
  policyArn?: string
  /** aws — inline policy name: created by create-custom, deleted by revoke. */
  inlinePolicyName?: string
  /** aws create-custom / create-custom-iam / create-principal — the IAM policy
   *  document (JSON), linted before propose and again before execute. */
  policyDocument?: string
  /** aws create-custom-iam / create-principal — the administrator-registered
   *  permissions boundary this change runs under. Revalidated against the
   *  target's allowlist at apply time; never accepted from the draft alone. */
  permissionsBoundaryArn?: string
  /** aws create-principal — name (and optional IAM path) of the user to create. */
  newUserName?: string
  newUserPath?: string
  // gcp
  targetServiceAccountEmail?: string
  role?: string
  /** gcp create-custom — project-level custom role id + its permissions. */
  customRoleId?: string
  permissions?: string[]
  // azure — target app registration client id + the built-in role definition
  // GUID to assign/remove on the target's service principal.
  targetClientId?: string
  roleDefinitionId?: string
  /** azure create-custom — custom role display name + its control/data-plane actions. */
  customRoleName?: string
  actions?: string[]
  dataActions?: string[]
}

export type PermissionGrantProposal = {
  _id?: ObjectIdType
  teamId: string
  /** Agent conversation/session the proposal was raised in. */
  sessionId: string
  /** The user whose session the agent ran in (not the approver). */
  createdByUserId: string
  provider: 'aws' | 'gcp' | 'azure'
  /** AWS account / GCP project / Azure subscription the changes apply in (one permission-admin binding governs it). */
  accountId?: string // aws
  projectId?: string // gcp
  subscriptionId?: string // azure
  /** The batch of changes to apply. */
  changes?: PermissionGrantChange[]
  // --- Legacy single-change fields (pre-batch proposals). Read via
  //     getProposalChanges(), which falls back to these when `changes` is absent. ---
  action?: 'grant' | 'revoke'
  targetRoleArn?: string
  targetServiceAccountEmail?: string
  grantLabel?: string
  policyArn?: string
  role?: string
  // --- Executor: the permission-admin binding that performs the change ---
  permissionAdminBindingId: string
  /** Human label for the permission-admin binding (role name / SA email). */
  permissionAdminLabel: string
  /** Why the agent is proposing this — shown to the reviewing admin. */
  reason: string
  status: PermissionGrantStatus
  createdAt: Date
  /** Administrator who approved/rejected. */
  decidedByUserId?: string
  decidedAt?: Date
  /** Set when execution fails, for display. */
  executionError?: string
}

/** Normalize a proposal to its list of changes — new proposals carry `changes`;
 *  legacy ones are synthesized from the old single-change top-level fields. */
export function getProposalChanges(p: PermissionGrantProposal): PermissionGrantChange[] {
  if (p.changes && p.changes.length > 0) return p.changes

  return [
    {
      action: p.action ?? 'grant',
      grantLabel: p.grantLabel ?? '(unknown)',
      targetRoleArn: p.targetRoleArn,
      policyArn: p.policyArn,
      targetServiceAccountEmail: p.targetServiceAccountEmail,
      role: p.role,
    },
  ]
}

/** The target ARN of an AWS change, across the old and new field spellings. */
export function changeTargetPrincipalArn(c: PermissionGrantChange): string | undefined {
  return c.targetPrincipalArn ?? c.targetRoleArn
}
