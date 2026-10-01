export type GcpRoleBinding = {
  role: string
  /** "principal" or "principalSet" — full member string Nuphos was matched on (e.g.
   *  "serviceAccount:foo@bar.iam.gserviceaccount.com"). */
  member: string
  /** Optional IAM condition expression / title. */
  condition?: { title?: string; description?: string; expression?: string }
}

export type GcpRoleDetails = {
  name: string
  title: string | null
  description: string | null
  stage: string | null
  /** Permissions list — capped for very broad roles like roles/owner. */
  includedPermissions: string[]
  /** True when the role's permission list was truncated. */
  truncated: boolean
  /** Error string if the role details couldn't be fetched (e.g. insufficient perms). */
  error: string | null
}

export type GcpIamPermissions = {
  projectId: string
  serviceAccountEmail: string
  warnings: string[]
  /** Bindings on the project where Nuphos's SA (directly or via a group) is a
   *  member. Empty array means we successfully read the IAM policy but the SA
   *  isn't bound — that's a real problem to surface in the UI. */
  bindings: GcpRoleBinding[]
  /** Detailed role definitions (permissions list) for each unique role in the
   *  bindings. Looked up via the IAM Roles API. */
  roles: GcpRoleDetails[]
  /** Fallback when getIamPolicy is denied: the subset of a curated Nuphos
   *  permission probe that the SA actually has on the project. Lets the user
   *  see "what can Nuphos do" even when "which roles" can't be read. */
  effectivePermissions: string[] | null
  selfCapabilities: SelfCapabilities
  serviceAccountCapabilities: ServiceAccountCapabilities
}

/** Same shape as the AWS variant — see aws-iam.ts for the contract. */
export type SelfCapabilities = {
  canRead: boolean
  canWrite: boolean
  inferred: boolean
  readReason: string
  writeReason: string
}

export type ServiceAccountCapabilities = {
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canSetIamPolicy: boolean
  reason: string
}

export type ProjectIamPolicy = {
  bindings?: {
    role?: string
    members?: string[]
    condition?: { title?: string; description?: string; expression?: string }
  }[]
}

export type IamRoleResponse = {
  name?: string
  title?: string
  description?: string
  stage?: string
  includedPermissions?: string[]
}
