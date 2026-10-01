import {
  getPermissionGrantProposal,
  setPermissionGrantProposalStatus,
} from '@/lib/agent/permission-grants'

import type { PermissionGrantProposal } from '@/lib/agent/permission-grants'

export type ApprovePermissionGrantResult =
  /** The proposal reached a terminal state — `executed`, or `failed` with the
   *  per-change errors on the document. IAM is not transactional, so a partial
   *  batch is a real outcome, not an exception. */
  | { ok: true; proposal: PermissionGrantProposal }
  | { ok: false; reason: 'not_found' | 'not_pending'; message: string }

/**
 * Callers must have already established that `actorUserId` is an administrator
 * of `teamIdStr` — this function does not check team membership, exactly like
 * the route it came from (the check is the route/interaction's gate).
 */
export async function approvePermissionGrantProposal(_args: {
  teamIdStr: string
  proposalId: string
  actorUserId: string
}): Promise<ApprovePermissionGrantResult> {
  // Historical cards and Slack buttons may still call this entry point.
  // The retired workflow must never mint a privileged credential or write IAM.

  return {
    ok: false,
    reason: 'not_pending',
    message:
      'Cloud permission proposals are no longer supported. Update permissions in your cloud console or use local_exec on an authorized device, then retry the task.',
  }
}

/** Same claim-once semantics as approval, for the Reject decision. */
export async function rejectPermissionGrantProposal(args: {
  teamIdStr: string
  proposalId: string
  actorUserId: string
}): Promise<ApprovePermissionGrantResult> {
  const p = await getPermissionGrantProposal(args.teamIdStr, args.proposalId)

  if (!p) {
    return { ok: false, reason: 'not_found', message: 'Permission-grant proposal not found' }
  }
  if (p.status !== 'proposed') {
    return { ok: false, reason: 'not_pending', message: `Proposal is already ${p.status}` }
  }
  const rejected = await setPermissionGrantProposalStatus(
    p._id!,
    { status: 'rejected', decidedByUserId: args.actorUserId, decidedAt: new Date() },
    'proposed',
  )

  if (!rejected) {
    return { ok: false, reason: 'not_pending', message: 'Proposal is no longer pending' }
  }
  const updated = await getPermissionGrantProposal(args.teamIdStr, p._id!.toHexString())

  return { ok: true, proposal: updated! }
}
