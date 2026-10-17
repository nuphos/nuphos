import type { BindingAccess } from '../types/k8s-core.ts'
import type { PlaudAccount, PlaudBindResult } from '../types/plaud.ts'

export type WindowPlaudApi = {
  atlasListPlaudAccounts(teamId: string): Promise<PlaudAccount[]>
  atlasStartPlaudOAuth(teamId: string): Promise<PlaudBindResult>
  atlasCancelPlaudOAuth(teamId: string): Promise<void>
  atlasUnbindPlaud(teamId: string, bindingId: string): Promise<void>
  atlasGetPlaudAccountAccess(teamId: string, bindingId: string): Promise<BindingAccess>
  atlasUpdatePlaudAccountAccess(
    teamId: string,
    bindingId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
}
