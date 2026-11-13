import type { BindingAccess } from '../types/k8s-core.ts'

export const bindingAccessApi = {
  atlasGetBindingAccess: (teamId: string, collection: string, bindingId: string) =>
    window.api.atlasGetBindingAccess(teamId, collection, bindingId),
  atlasUpdateBindingAccess: (
    teamId: string,
    collection: string,
    bindingId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateBindingAccess(teamId, collection, bindingId, access),
  atlasSetTeamBindingShareDefault: (teamId: string, share: 'private' | 'team') =>
    window.api.atlasSetTeamBindingShareDefault(teamId, share),
}
