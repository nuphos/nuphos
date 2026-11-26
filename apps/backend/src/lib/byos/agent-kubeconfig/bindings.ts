import { canPrincipalsUseAllowList } from '@/lib/byos/access'

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
  selectedIds: string[] | true | undefined,
  principals: readonly string[],
): T[] {
  const selected = selectedIds === true ? undefined : new Set(selectedIds ?? [])

  return (list ?? []).filter(
    (binding) =>
      (!selected || selected.has(binding.id.toHexString())) &&
      canPrincipalsUseAllowList(binding.access?.memberAllowList, principals) &&
      binding.purpose !== 'permission-admin',
  )
}

type K8sSelectionKey =
  | 'awsRoleIds'
  | 'gcpServiceAccountIds'
  | 'tencentAccountIds'
  | 'aliyunAccountIds'
  | 'linodeAccountIds'
  | 'volcengineAccountIds'
  | 'azureAccountIds'
  | 'onpremClusterIds'

/**
 * The bindings whose clusters may appear in an agent session's kubeconfig:
 * the same gate as the per-cluster credential routes — session-selected,
 * on the member list of everyone the session acts for, and never a
 * permission-admin (human-only break-glass) binding.
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
  /** The sender and the conversation's owner. */
  principals: readonly string[]
}): AgentK8sBindings {
  const { bindings, selected, principals } = opts
  // "All" takes every binding as it stands now; the allow-list check below still applies.
  const ids = (key: K8sSelectionKey) => (selected?.allCredentials ? true : selected?.[key])

  return {
    aws: permitted(bindings?.awsRoles, ids('awsRoleIds'), principals),
    gcp: permitted(bindings?.gcpServiceAccounts, ids('gcpServiceAccountIds'), principals),
    tencent: permitted(bindings?.tencentAccounts, ids('tencentAccountIds'), principals),
    aliyun: permitted(bindings?.aliyunAccounts, ids('aliyunAccountIds'), principals),
    linode: permitted(bindings?.linodeAccounts, ids('linodeAccountIds'), principals),
    volcengine: permitted(bindings?.volcengineAccounts, ids('volcengineAccountIds'), principals),
    azure: permitted(bindings?.azureAccounts, ids('azureAccountIds'), principals),
    onprem: permitted(bindings?.onpremClusters, ids('onpremClusterIds'), principals),
  }
}

export function hasAgentK8sBindings(bindings: AgentK8sBindings): boolean {
  return Object.values(bindings).some((list) => list.length > 0)
}
