/** Whether the principal can introspect and/or modify its own permissions.
 *  Useful so the customer knows whether they can adjust Nuphos's scope from
 *  this account itself, or have to go through a higher-privileged user.
 *  `inferred` means we couldn't run an authoritative check (e.g. AWS
 *  iam:SimulatePrincipalPolicy is denied) and fell back to scanning the
 *  granted policy statements. */
export type SelfCapabilities = {
  canRead: boolean
  canWrite: boolean
  inferred: boolean
  readReason: string
  writeReason: string
}

export type IamStatement = {
  /** "Allow" or "Deny", but the document is untrusted JSON so it stays open. */
  effect: string
  actions: string[]
  notActions?: string[]
  resources: string[]
  notResources?: string[]
  conditionSummary?: string
}

export type IamPolicy = {
  /** Inline policy name, or managed policy ARN. */
  name: string
  /** "inline" — embedded in the role; "managed" — AWS-managed or customer-managed. */
  kind: 'inline' | 'managed'
  /** Managed only — the AWS or customer ARN. */
  arn?: string
  /** Managed only — whether this is an AWS-managed (vs customer-managed) policy. */
  awsManaged?: boolean
  /** Active policy version for managed policies (e.g. "v3"). */
  versionId?: string
  /** Last time the policy document was updated (managed policies only). */
  updatedAt?: string
  /** Decoded policy document — Statements normalized to arrays. */
  statements: IamStatement[]
}

export type AwsIamPermissions = {
  accountId: string
  roleArn: string
  roleName: string
  trustPolicySummary: string | null
  callerArn: string | null
  callerUserId: string | null
  /** When listing the role policies hits an authorization error, the role is
   *  reachable for AssumeRole but can't read its own IAM metadata. We return
   *  partial data with this filled in so the UI can explain why. */
  warnings: string[]
  policies: IamPolicy[]
  selfCapabilities: SelfCapabilities
}

export function parseAwsList<T>(value: T[] | undefined): T[] {
  return value ?? []
}

// Policy JSON writes a single-element list as a bare string.
type PolicyStringList = string | string[] | undefined

function asArray(v: PolicyStringList): string[] {
  if (v === undefined) return []

  return Array.isArray(v) ? v : [v]
}

function normalizeStatement(raw: unknown): IamStatement | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const effect = typeof s.Effect === 'string' ? s.Effect : 'Allow'
  const actions = asArray(s.Action as PolicyStringList)
  const notActions = asArray(s.NotAction as PolicyStringList)
  const resources = asArray(s.Resource as PolicyStringList)
  const notResources = asArray(s.NotResource as PolicyStringList)
  let conditionSummary: string | undefined

  if (s.Condition && typeof s.Condition === 'object') {
    try {
      conditionSummary = JSON.stringify(s.Condition)
    } catch {
      conditionSummary = '[unserializable condition]'
    }
  }

  return {
    effect,
    actions,
    ...(notActions.length ? { notActions } : {}),
    resources,
    ...(notResources.length ? { notResources } : {}),
    ...(conditionSummary ? { conditionSummary } : {}),
  }
}

export function decodePolicyDocument(doc: string | undefined): IamStatement[] {
  if (!doc) return []
  // IAM policy documents are URL-encoded when returned by GetRolePolicy /
  // GetPolicyVersion. They're plain JSON either way once decoded.
  let raw = doc

  try {
    raw = decodeURIComponent(doc)
  } catch {
    // already decoded
  }
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const statements = (parsed as { Statement?: unknown }).Statement
  const list = Array.isArray(statements) ? statements : statements ? [statements] : []

  return list.map(normalizeStatement).filter((s): s is IamStatement => s !== null)
}

export function extractRoleNameFromArn(roleArn: string): string | null {
  const match = /^arn:aws:iam::\d{12}:role\/(.+)$/.exec(roleArn)

  if (!match?.[1]) return null
  // Role names may contain a path prefix; the actual name is the final segment.
  const parts = match[1].split('/')

  return parts[parts.length - 1] || null
}

export function summarizeError(prefix: string, e: unknown): string {
  const name = (e as { name?: string })?.name ?? 'Error'
  const message = e instanceof Error ? e.message : String(e)

  return `${prefix}: ${name} — ${message}`
}
