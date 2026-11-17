import type { BindingAccess } from '../types/k8s-core.ts'

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
}
