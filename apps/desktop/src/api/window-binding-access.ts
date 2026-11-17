import type { TeamShareDefault } from '../lib/bindingShare.ts'
import type { BindingAccess } from '../types/k8s-core.ts'
import type { AtlasTeam } from '../types/team.ts'

export type WindowBindingAccessApi = {
  atlasGetBindingAccess(
    teamId: string,
    collection: string,
    bindingId: string,
  ): Promise<BindingAccess>
  atlasUpdateBindingAccess(
    teamId: string,
    collection: string,
    bindingId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasSetTeamBindingShareDefault(
    teamId: string,
    share: 'private' | 'team',
  ): Promise<AtlasTeam & TeamShareDefault>
}
