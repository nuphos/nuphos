import { canUseAllowList } from '@/lib/byos/access'

import type { AgentCredentialAccess } from '@/lib/agent/db'
import type {
  AliyunAccountBinding,
  AwsRoleBinding,
  AzureAccountBinding,
  BindingAccess,
  BindingPurpose,
  GcpServiceAccountBinding,
  LinodeAccountBinding,
  OnpremClusterBinding,
  TencentAccountBinding,
  VolcengineAccountBinding,
} from '@/models'
import type { ObjectId } from 'mongodb'

/** Every provider whose clusters the agent can reach, keyed by provider slug. */
export type AgentK8sBindings = {
  aws: AwsRoleBinding[]
  gcp: GcpServiceAccountBinding[]
  tencent: TencentAccountBinding[]
  aliyun: AliyunAccountBinding[]
  linode: LinodeAccountBinding[]
  volcengine: VolcengineAccountBinding[]
  azure: AzureAccountBinding[]
  onprem: OnpremClusterBinding[]
}

type SelectableBinding = { id: ObjectId; access?: BindingAccess; purpose?: BindingPurpose }

function permitted<T extends SelectableBinding>(
  list: T[] | undefined,
  selectedIds: string[] | undefined,
  userId: string,
): T[] {
  const selected = new Set(selectedIds ?? [])

  return (list ?? []).filter(
    (binding) =>
      selected.has(binding.id.toHexString()) &&
      canUseAllowList(binding.access?.memberAllowList, userId) &&
      binding.purpose !== 'permission-admin',
  )
}

/**
 * The bindings whose clusters may appear in an agent session's kubeconfig:
 * the same gate as the per-cluster credential routes — session-selected,
 * member allow-listed, and never a permission-admin (human-only break-glass)
 * binding.
 */
export function selectAgentK8sBindings(opts: {
  bindings: {
    awsRoles?: AwsRoleBinding[]
    gcpServiceAccounts?: GcpServiceAccountBinding[]
    tencentAccounts?: TencentAccountBinding[]
    aliyunAccounts?: AliyunAccountBinding[]
    linodeAccounts?: LinodeAccountBinding[]
    volcengineAccounts?: VolcengineAccountBinding[]
    azureAccounts?: AzureAccountBinding[]
    onpremClusters?: OnpremClusterBinding[]
  } | null
  selected: Partial<AgentCredentialAccess> | undefined
  userId: string
}): AgentK8sBindings {
  const { bindings, selected, userId } = opts

  return {
    aws: permitted(bindings?.awsRoles, selected?.awsRoleIds, userId),
    gcp: permitted(bindings?.gcpServiceAccounts, selected?.gcpServiceAccountIds, userId),
    tencent: permitted(bindings?.tencentAccounts, selected?.tencentAccountIds, userId),
    aliyun: permitted(bindings?.aliyunAccounts, selected?.aliyunAccountIds, userId),
    linode: permitted(bindings?.linodeAccounts, selected?.linodeAccountIds, userId),
    volcengine: permitted(bindings?.volcengineAccounts, selected?.volcengineAccountIds, userId),
    azure: permitted(bindings?.azureAccounts, selected?.azureAccountIds, userId),
    onprem: permitted(bindings?.onpremClusters, selected?.onpremClusterIds, userId),
  }
}

export function hasAgentK8sBindings(bindings: AgentK8sBindings): boolean {
  return Object.values(bindings).some((list) => list.length > 0)
}
