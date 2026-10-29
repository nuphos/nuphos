import { call } from './client.ts'

import type { Team } from './teams.ts'
import type {
  LocalAgentShareState,
  LocalShareApproval,
  LocalShareInput,
  LocalShareLevel,
  ShareApprovalStatus,
  LocalShareTrust,
  ShareTrustDuration,
  SignInAsk,
} from '../../src/api/device-types.ts'

// Sharing this person's own computer's Local Agent with teammates in one team.

const share = (deviceId: string, teamId: string) =>
  `/agent/devices/${encodeURIComponent(deviceId)}/share?teamId=${encodeURIComponent(teamId)}`

export function getDeviceShare(deviceId: string, teamId: string): Promise<LocalAgentShareState> {
  return call<LocalAgentShareState>('GET', share(deviceId, teamId))
}

export function setDeviceShare(
  deviceId: string,
  teamId: string,
  input: LocalShareInput,
): Promise<LocalAgentShareState> {
  return call<LocalAgentShareState>('PUT', share(deviceId, teamId), input, { retry: false })
}

export async function listShareApprovals(teamId: string): Promise<LocalShareApproval[]> {
  const { approvals } = await call<{ approvals: LocalShareApproval[] }>(
    'GET',
    `/agent/devices/share-approvals?teamId=${encodeURIComponent(teamId)}`,
  )

  return approvals
}

/** Whether this person's own conversation still waits for the owner of the computer it asked for. */
export async function ownShareApprovalStatus(sessionId: string): Promise<ShareApprovalStatus> {
  const { status } = await call<{ status: ShareApprovalStatus }>(
    'GET',
    `/agent/devices/share-approvals/mine?sessionId=${encodeURIComponent(sessionId)}`,
  )

  return status
}

export function decideShareApproval(
  approvalId: string,
  approve: boolean,
  trust?: ShareTrustDuration,
): Promise<{ id: string; status: string }> {
  return call(
    'POST',
    `/agent/devices/share-approvals/${encodeURIComponent(approvalId)}`,
    { approve, ...(trust ? { trust } : {}) },
    { retry: false },
  )
}

const trusts = (deviceId: string, teamId: string, actorId?: string) =>
  `/agent/devices/${encodeURIComponent(deviceId)}/share-trusts${
    actorId ? `/${encodeURIComponent(actorId)}` : ''
  }?teamId=${encodeURIComponent(teamId)}`

/** Teammates the owner trusts on this computer in this team. */
export async function listShareTrusts(
  deviceId: string,
  teamId: string,
): Promise<LocalShareTrust[]> {
  return (await call<{ trusts: LocalShareTrust[] }>('GET', trusts(deviceId, teamId))).trusts
}

export async function dropShareTrust(
  deviceId: string,
  teamId: string,
  actorId: string,
): Promise<void> {
  await call('DELETE', trusts(deviceId, teamId, actorId), undefined, { retry: false })
}

export function setTeamLocalAgentSharing(teamId: string, level: LocalShareLevel): Promise<Team> {
  return call<Team>('PUT', `/teams/${teamId}/local-agent-sharing`, { level }, { retry: false })
}

const runtime = (teamId: string, runtimeId: string) =>
  `/teams/${encodeURIComponent(teamId)}/agent-runtimes/${encodeURIComponent(runtimeId)}`

/** Asks whoever can sign this conversation's agent in; the next send waits for them. */
export function askRuntimeSignIn(
  teamId: string,
  runtimeId: string,
  sessionId: string,
): Promise<SignInAsk> {
  return call(
    'POST',
    `${runtime(teamId, runtimeId)}/sign-in-requests`,
    { sessionId },
    { retry: false },
  )
}

/** This computer's agent signed in through its own CLI: what waited for it runs now. */
export function settleRuntimeSignIn(teamId: string, runtimeId: string): Promise<void> {
  return call('DELETE', `${runtime(teamId, runtimeId)}/sign-in-requests`, undefined, {
    retry: false,
  })
}
