import { call } from './client'
// ---------- File transfer ----------
// When a sessionId is present the transfer is tagged to that conversation via
// the agent-session-scoped mount; otherwise it's a plain team-level transfer.
function fileTransferBase(teamId: string, sessionId?: string): string {
  return sessionId
    ? `/agent-sessions/${encodeURIComponent(sessionId)}/teams/${encodeURIComponent(teamId)}/file-transfers`
    : `/teams/${encodeURIComponent(teamId)}/file-transfers`
}

export async function postFileTransfer<T>(
  teamId: string,
  sessionId: string | undefined,
  suffix: string,
  body?: unknown,
): Promise<T> {
  // No retries: create-transfer is non-idempotent — a lost response after the
  // backend already inserted the group would otherwise spawn a duplicate pending
  // transfer + presign set on retry.
  return call<T>('POST', `${fileTransferBase(teamId, sessionId)}${suffix}`, body, { retry: false })
}

export async function getFileTransfer<T>(
  teamId: string,
  sessionId: string | undefined,
  suffix: string,
): Promise<T> {
  return call<T>('GET', `${fileTransferBase(teamId, sessionId)}${suffix}`)
}

export async function listFileTransferDownloads(
  teamId: string,
  sessionId: string | undefined,
): Promise<{ groups: unknown[] }> {
  return call<{ groups: unknown[] }>('GET', `${fileTransferBase(teamId, sessionId)}/downloads`)
}

export type PermissionGrantProposalView = {
  id: string
  provider: 'aws' | 'gcp'
  action: 'grant' | 'revoke'
  changeCount: number
  status: 'proposed' | 'rejected' | 'executing' | 'executed' | 'failed'
  grantLabel: string
  reason: string
  decisions: { label: string; value: string }[]
  permissionAdminLabel: string
  executionError: string | null
  createdAt?: string
  createdByUserId: string
  decidedByUserId: string | null
}

export async function listPermissionGrantProposals(
  teamId: string,
): Promise<PermissionGrantProposalView[]> {
  return call<PermissionGrantProposalView[]>('GET', `/teams/${teamId}/permission-grant-proposals`)
}

export async function getPermissionGrantProposal(
  teamId: string,
  id: string,
): Promise<PermissionGrantProposalView> {
  return call<PermissionGrantProposalView>(
    'GET',
    `/teams/${teamId}/permission-grant-proposals/${id}`,
  )
}

export async function approvePermissionGrantProposal(
  teamId: string,
  id: string,
): Promise<PermissionGrantProposalView> {
  return call<PermissionGrantProposalView>(
    'POST',
    `/teams/${teamId}/permission-grant-proposals/${id}/approve`,
  )
}

export async function rejectPermissionGrantProposal(
  teamId: string,
  id: string,
): Promise<PermissionGrantProposalView> {
  return call<PermissionGrantProposalView>(
    'POST',
    `/teams/${teamId}/permission-grant-proposals/${id}/reject`,
  )
}
