import { call } from './client.ts'

import type {
  LocalAgentShareState,
  LocalShareApproval,
  LocalShareInput,
  LocalShareLevel,
} from '../../src/api/device-types.ts'
import type { Team } from './teams.ts'

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

export function decideShareApproval(
  approvalId: string,
  approve: boolean,
): Promise<{ id: string; status: string }> {
  return call(
    'POST',
    `/agent/devices/share-approvals/${encodeURIComponent(approvalId)}`,
    { approve },
    { retry: false },
  )
}

export function setTeamLocalAgentSharing(teamId: string, level: LocalShareLevel): Promise<Team> {
  return call<Team>('PUT', `/teams/${teamId}/local-agent-sharing`, { level }, { retry: false })
}
