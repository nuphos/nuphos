import type { BindingShare } from '../lib/bindingShare.ts'
import type { BindingAccess } from '../types/k8s-core.ts'

export const plaudApi = {
  atlasListPlaudAccounts: (teamId: string) => window.api.atlasListPlaudAccounts(teamId),
  atlasStartPlaudOAuth: (teamId: string, share?: BindingShare) =>
    window.api.atlasStartPlaudOAuth(teamId, share),
  atlasCancelPlaudOAuth: (teamId: string) => window.api.atlasCancelPlaudOAuth(teamId),
  atlasUnbindPlaud: (teamId: string, bindingId: string) =>
    window.api.atlasUnbindPlaud(teamId, bindingId),
  atlasGetPlaudAccountAccess: (teamId: string, bindingId: string) =>
    window.api.atlasGetPlaudAccountAccess(teamId, bindingId),
  atlasUpdatePlaudAccountAccess: (
    teamId: string,
    bindingId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdatePlaudAccountAccess(teamId, bindingId, access),
}
