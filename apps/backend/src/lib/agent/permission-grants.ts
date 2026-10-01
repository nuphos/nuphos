import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'

import { changeTargetPrincipalArn, getProposalChanges } from './permission-grants-types'

import type {
  PermissionChangeAction,
  PermissionGrantChange,
  PermissionGrantProposal,
  PermissionGrantStatus,
} from './permission-grants-types'
import type { Collection, ObjectId as ObjectIdType } from 'mongodb'

export { changeTargetPrincipalArn, getProposalChanges } from './permission-grants-types'
export type {
  PermissionChangeAction,
  PermissionGrantChange,
  PermissionGrantProposal,
  PermissionGrantStatus,
} from './permission-grants-types'

function changeVerb(action: PermissionChangeAction): string {
  if (action === 'revoke') return 'Revoke'
  if (action === 'create-principal') return 'Create principal'
  if (action === 'create-custom' || action === 'create-custom-iam') return 'Create'

  return 'Grant'
}

/** Short summary label for lists (the Plans row title). */
export function proposalSummaryLabel(p: PermissionGrantProposal): string {
  const changes = getProposalChanges(p)

  if (changes.length === 1) {
    const c = changes[0]!

    return `${changeVerb(c.action)} ${c.grantLabel}`
  }
  const counts = new Map<string, number>([
    ['grant', 0],
    ['create', 0],
    ['revoke', 0],
  ])

  for (const c of changes) {
    const key = c.action.startsWith('create') ? 'create' : c.action

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts.entries()].filter(([, n]) => n > 0).map(([k, n]) => `${k} ${String(n)}`)

  return `${String(changes.length)} permission changes (${parts.join(', ')})`
}

const COLLECTION = 'permission_grant_proposals'

export const permissionGrantProposals = (): Collection<PermissionGrantProposal> =>
  db().collection<PermissionGrantProposal>(COLLECTION)

export async function getPermissionGrantProposal(
  teamId: string,
  id: string,
): Promise<PermissionGrantProposal | null> {
  if (!ObjectId.isValid(id)) return null

  return permissionGrantProposals().findOne({ _id: new ObjectId(id), teamId })
}

export async function listPermissionGrantProposalsForSession(
  teamId: string,
  sessionId: string,
): Promise<PermissionGrantProposal[]> {
  return permissionGrantProposals().find({ teamId, sessionId }).sort({ createdAt: 1 }).toArray()
}

/**
 * Team-wide proposals for the Plans surface. Administrators see every team
 * proposal (they are the only ones who can approve, so the Plans page is their
 * review queue); other members see only the ones they created — enough to copy
 * the shareable URL and hand it to an admin, without exposing everyone else's
 * pending requests.
 */
export async function listPermissionGrantProposalsForTeam(
  teamId: string,
  viewer: { userId: string; isAdmin: boolean },
): Promise<PermissionGrantProposal[]> {
  const filter = viewer.isAdmin ? { teamId } : { teamId, createdByUserId: viewer.userId }

  return permissionGrantProposals().find(filter).sort({ createdAt: -1 }).toArray()
}

/**
 * Compare-and-set the proposal status. Pass `expectedStatus` to make the
 * transition atomic (only applies if the doc is still in that status) — returns
 * false when another concurrent approve/reject already moved it, so callers can
 * abort instead of racing into conflicting terminal states.
 */
export async function setPermissionGrantProposalStatus(
  id: ObjectIdType,
  patch: Partial<
    Pick<PermissionGrantProposal, 'status' | 'decidedByUserId' | 'decidedAt' | 'executionError'>
  >,
  expectedStatus?: PermissionGrantStatus,
): Promise<boolean> {
  const res = await permissionGrantProposals().updateOne(
    expectedStatus ? { _id: id, status: expectedStatus } : { _id: id },
    { $set: patch },
  )

  return res.matchedCount === 1
}

/** Render an AWS policy document into per-statement review rows. The admin must
 *  approve against the real actions/resources, not the model-controlled label —
 *  same principle as showing the Azure roleDefinitionId GUID. */
function awsPolicyDocumentRows(doc: string | undefined): { label: string; value: string }[] {
  if (!doc) return [{ label: 'Policy', value: '(missing policy document)' }]
  try {
    const parsed = JSON.parse(doc) as { Statement?: unknown }
    const statements = Array.isArray(parsed.Statement) ? parsed.Statement : [parsed.Statement]

    return statements.map((raw) => {
      const s = raw as {
        Action?: string | string[]
        Resource?: string | string[]
        Condition?: unknown
      }
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action ?? '(none)']
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource ?? '(none)']
      const cond = s.Condition ? ` when ${JSON.stringify(s.Condition)}` : ''

      return { label: 'Allow', value: `${actions.join(', ')} on ${resources.join(', ')}${cond}` }
    })
  } catch {
    return [{ label: 'Policy', value: doc }]
  }
}

/** Review rows for one AWS change. The boundary is shown on its own row: it is
 *  the ceiling the approver is really signing off on. */
function awsChangeRows(c: PermissionGrantChange): { label: string; value: string }[] {
  const target = changeTargetPrincipalArn(c) ?? '(unknown principal)'
  const boundary = c.permissionsBoundaryArn
    ? [{ label: 'Permissions boundary', value: c.permissionsBoundaryArn }]
    : []

  if (c.action === 'create-principal') {
    return [
      {
        label: 'Create IAM user',
        value: `${c.newUserPath ?? '/'}${c.newUserName ?? c.grantLabel} (no credentials are created)`,
      },
      ...boundary,
      ...(c.policyDocument
        ? [
            { label: 'Create policy', value: `${c.inlinePolicyName ?? c.grantLabel} (inline)` },
            ...awsPolicyDocumentRows(c.policyDocument),
          ]
        : []),
    ]
  }
  if (c.action === 'create-custom' || c.action === 'create-custom-iam') {
    return [
      {
        label: 'Create policy',
        value: `${c.inlinePolicyName ?? c.grantLabel} (inline) on ${target}`,
      },
      ...boundary,
      ...awsPolicyDocumentRows(c.policyDocument),
    ]
  }
  if (c.action === 'revoke' && c.inlinePolicyName) {
    return [{ label: 'Delete policy', value: `${c.inlinePolicyName} (inline) from ${target}` }]
  }
  const verb = c.action === 'revoke' ? 'Detach' : 'Attach'
  const prep = c.action === 'revoke' ? 'from' : 'to'

  return [{ label: verb, value: `${c.grantLabel} ${prep} ${target}` }]
}

/** Compact KV summary of the proposed change, for the review card. */
export function proposalDecisions(p: PermissionGrantProposal): { label: string; value: string }[] {
  const changes = getProposalChanges(p)
  const rows: { label: string; value: string }[] = []

  if (p.provider === 'aws') {
    for (const c of changes) rows.push(...awsChangeRows(c))
    rows.push({ label: 'AWS account', value: p.accountId ?? '(unknown)' })
  } else if (p.provider === 'azure') {
    for (const c of changes) {
      if (c.action === 'create-custom') {
        rows.push({
          label: 'Create role',
          value: `${c.customRoleName ?? c.grantLabel} — grant to app ${c.targetClientId ?? '(unknown app)'}`,
        })
        if (c.actions?.length) rows.push({ label: 'Actions', value: c.actions.join(', ') })
        if (c.dataActions?.length)
          rows.push({ label: 'Data actions', value: c.dataActions.join(', ') })
      } else {
        const verb = c.action === 'revoke' ? 'Revoke' : 'Grant'
        const prep = c.action === 'revoke' ? 'from' : 'to'
        // Show the role-definition GUID that will actually be assigned — the label
        // is model-controlled, so an admin must approve against the real role id
        // (a "Reader"-labeled change could otherwise carry an Owner GUID).
        const role = c.roleDefinitionId
          ? `${c.grantLabel} [roleDefinitionId ${c.roleDefinitionId}]`
          : c.grantLabel

        rows.push({
          label: verb,
          value: `${role} ${prep} app ${c.targetClientId ?? '(unknown app)'}`,
        })
      }
    }
    rows.push({ label: 'Azure subscription', value: p.subscriptionId ?? '(unknown)' })
  } else {
    for (const c of changes) {
      if (c.action === 'create-custom') {
        rows.push({
          label: 'Create role',
          value: `${c.customRoleId ?? c.grantLabel} — grant to ${c.targetServiceAccountEmail ?? '(unknown SA)'}`,
        })
        rows.push({ label: 'Permissions', value: (c.permissions ?? []).join(', ') })
      } else {
        const verb = c.action === 'revoke' ? 'Revoke' : 'Grant'
        const prep = c.action === 'revoke' ? 'from' : 'to'

        rows.push({
          label: verb,
          value: `${c.grantLabel} ${prep} ${c.targetServiceAccountEmail ?? '(unknown SA)'}`,
        })
      }
    }
    rows.push({ label: 'GCP project', value: p.projectId ?? '(unknown)' })
  }
  rows.push({ label: 'Via permission-admin', value: p.permissionAdminLabel })

  return rows
}
