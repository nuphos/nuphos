import { Hono } from 'hono'

import {
  approvePermissionGrantProposal,
  rejectPermissionGrantProposal,
} from '@/lib/agent/permission-grant-approve'
import {
  getPermissionGrantProposal,
  listPermissionGrantProposalsForTeam,
  proposalDecisions,
  getProposalChanges,
  proposalSummaryLabel,
} from '@/lib/agent/permission-grants'
import { notePreviewDecision } from '@/lib/claude-code-preview/preview-decision-notes'
import { AppError } from '@/lib/errors'
import { requireTeamRole } from '@/middleware/auth'

import type { PermissionGrantProposal } from '@/lib/agent/permission-grants'
import type { TeamAuthVariables } from '@/middleware/auth'

export const permissionGrantProposalsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

function serialize(p: PermissionGrantProposal) {
  const changes = getProposalChanges(p)
  // 'revoke' only when EVERY change is a revoke, so the card can read "removal";
  // any grant (incl. mixed) reads as the generic "change".
  const action = changes.every((c) => c.action === 'revoke') ? 'revoke' : 'grant'

  return {
    id: p._id!.toHexString(),
    provider: p.provider,
    action,
    changeCount: changes.length,
    status: p.status,
    grantLabel: proposalSummaryLabel(p),
    reason: p.reason,
    decisions: proposalDecisions(p),
    permissionAdminLabel: p.permissionAdminLabel,
    executionError: p.executionError ?? null,
    createdAt: p.createdAt,
    createdByUserId: p.createdByUserId,
    decidedByUserId: p.decidedByUserId ?? null,
  }
}

// Team-wide list for the Plans surface. Admins get every proposal (their review
// queue); non-admins get only their own (enough to grab the shareable URL).
permissionGrantProposalsRoutes.get('/', async (c) => {
  const teamId = c.get('teamId')
  const userId = c.get('userId')
  const isAdmin = c.get('teamRole') === 'ADMINISTRATOR'
  const rows = await listPermissionGrantProposalsForTeam(teamId, { userId, isAdmin })

  return c.json(rows.map(serialize))
})

permissionGrantProposalsRoutes.get('/:id', async (c) => {
  const teamId = c.get('teamId')
  const p = await getPermissionGrantProposal(teamId, c.req.param('id'))

  if (!p) throw new AppError(404, 'proposal_not_found', 'Permission-grant proposal not found')

  return c.json(serialize(p))
})

// Approve → execute the change deterministically via the permission-admin
// binding (the agent never performs the IAM write). Administrators only.
permissionGrantProposalsRoutes.post('/:id/approve', requireTeamRole('ADMINISTRATOR'), async (c) => {
  // The IAM work lives in lib/agent/permission-grant-approve.ts so the Slack
  // Approve button executes the same code, under the same admin gate.
  const result = await approvePermissionGrantProposal({
    teamIdStr: c.get('teamId'),
    proposalId: c.req.param('id'),
    actorUserId: c.get('userId'),
  })

  if (!result.ok) {
    throw result.reason === 'not_found'
      ? new AppError(404, 'proposal_not_found', result.message)
      : new AppError(409, 'proposal_not_pending', result.message)
  }
  await notePreviewDecision('permission-grant', c.req.param('id'), 'approved', c.get('userId'))

  return c.json(serialize(result.proposal))
})

permissionGrantProposalsRoutes.post('/:id/reject', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const result = await rejectPermissionGrantProposal({
    teamIdStr: c.get('teamId'),
    proposalId: c.req.param('id'),
    actorUserId: c.get('userId'),
  })

  if (!result.ok) {
    throw result.reason === 'not_found'
      ? new AppError(404, 'proposal_not_found', result.message)
      : new AppError(409, 'proposal_not_pending', result.message)
  }
  await notePreviewDecision('permission-grant', c.req.param('id'), 'rejected', c.get('userId'))

  return c.json(serialize(result.proposal))
})
