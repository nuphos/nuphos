import { previewTeamImport, confirmTeamImport } from '../atlas/team-import'
import { saveTeamExport } from '../atlas/team-migration'

import type { IpcMainInvokeEvent } from 'electron'

export const migrationChannels = {
  'atlas:previewTeamImport': (event: IpcMainInvokeEvent) => previewTeamImport(event),
  'atlas:confirmTeamImport': (event: IpcMainInvokeEvent, token: string, sourceMember?: string) =>
    confirmTeamImport(event, token, sourceMember),
  'atlas:exportTeam': (event: IpcMainInvokeEvent, teamId: string) => saveTeamExport(event, teamId),
}
