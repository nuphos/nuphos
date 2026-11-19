import { previewTeamImport, confirmTeamImport } from '../atlas/team-import'
import { saveTeamExport } from '../atlas/team-migration'
import { inviteTeamMember, resendTeamInvitation } from '../atlas/team-invitations'

import type { IpcMainInvokeEvent } from 'electron'

function teamRole(value: unknown): 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER' {
  return value === 'ADMINISTRATOR' || value === 'VIEWER' ? value : 'EDITOR'
}

export const migrationChannels = {
  'atlas:previewTeamImport': (event: IpcMainInvokeEvent) => previewTeamImport(event),
  'atlas:confirmTeamImport': (event: IpcMainInvokeEvent, token: string, sourceMember?: string) =>
    confirmTeamImport(event, token, sourceMember),
  'atlas:exportTeam': (event: IpcMainInvokeEvent, teamId: string) => saveTeamExport(event, teamId),
  // Invitations live here rather than in channels-team.ts, which is at its size limit.
  'atlas:inviteTeamMember': (_e: unknown, teamId: string, inviteeEmail: string, role?: string) =>
    inviteTeamMember(teamId, inviteeEmail, teamRole(role)),
  'atlas:resendTeamInvitation': (_e: unknown, teamId: string, invitationId: string) =>
    resendTeamInvitation(teamId, invitationId),
}
