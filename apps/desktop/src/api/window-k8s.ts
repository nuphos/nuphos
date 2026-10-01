import type { ApplyResourceIdentity, ScalableWorkloadKind } from './app-types.ts'
import type { WorkloadLogEvent } from './watch-types.ts'
import type {
  ContextInfo,
  DeploymentEnvContainerType,
  DeploymentEnvDetail,
  DeploymentEnvUpdateInput,
  DeploymentItem,
  NamespaceItem,
  NodeItem,
  PodItem,
  PodLabelSelector,
} from '../types/k8s-core.ts'
import type { EventItem, NodeDetail, PodDetail } from '../types/k8s-detail.ts'
import type {
  ClusterRoleBindingItem,
  ClusterRoleItem,
  ConfigMapItem,
  CustomResourceDefinitionItem,
  CustomResourceItem,
  CustomResourceType,
  EndpointSliceItem,
  HelmReleaseItem,
  IngressItem,
  NetworkPolicyItem,
  PersistentVolumeClaimItem,
  PersistentVolumeItem,
  RoleBindingItem,
  RoleItem,
  SecretItem,
  ServiceAccountItem,
  StorageClassItem,
} from '../types/k8s-resources.ts'
import type {
  ContainerUsageRow,
  CronJobDetail,
  CronJobItem,
  CronJobTriggerInfo,
  DaemonSetItem,
  JobItem,
  LogQuery,
  ReplicaSetItem,
  ServiceItem,
  StatefulSetItem,
  WorkloadLogLine,
} from '../types/k8s-workloads.ts'

export type WindowK8sApi = {
  listContexts(): Promise<ContextInfo[]>
  probeClusterAccess(context: string): Promise<{ ok: boolean; errors: string[] }>
  listNamespaceNames(
    context: string,
  ): Promise<{ names: string[]; truncated: boolean; total: number | null }>
  listNamespaces(context: string): Promise<NamespaceItem[]>
  listPods(context: string, namespace: string | null): Promise<PodItem[]>
  listDeployments(context: string, namespace: string | null): Promise<DeploymentItem[]>
  listNodes(context: string): Promise<NodeItem[]>
  listContainerUsage(context: string): Promise<ContainerUsageRow[]>
  listServices(context: string, namespace: string | null): Promise<ServiceItem[]>
  listReplicaSets(context: string, namespace: string | null): Promise<ReplicaSetItem[]>
  listStatefulSets(context: string, namespace: string | null): Promise<StatefulSetItem[]>
  listDaemonSets(context: string, namespace: string | null): Promise<DaemonSetItem[]>
  listJobs(context: string, namespace: string | null): Promise<JobItem[]>
  listCronJobs(context: string, namespace: string | null): Promise<CronJobItem[]>
  getCronJobDetail(context: string, namespace: string, name: string): Promise<CronJobDetail>
  listIngresses(context: string, namespace: string | null): Promise<IngressItem[]>
  listNetworkPolicies(context: string, namespace: string | null): Promise<NetworkPolicyItem[]>
  listEndpointSlices(context: string, namespace: string | null): Promise<EndpointSliceItem[]>
  listConfigMaps(context: string, namespace: string | null): Promise<ConfigMapItem[]>
  listSecrets(context: string, namespace: string | null): Promise<SecretItem[]>
  listStorageClasses(context: string): Promise<StorageClassItem[]>
  listServiceAccounts(context: string, namespace: string | null): Promise<ServiceAccountItem[]>
  listRoles(context: string, namespace: string | null): Promise<RoleItem[]>
  listRoleBindings(context: string, namespace: string | null): Promise<RoleBindingItem[]>
  listClusterRoles(context: string): Promise<ClusterRoleItem[]>
  listClusterRoleBindings(context: string): Promise<ClusterRoleBindingItem[]>
  listPersistentVolumes(context: string): Promise<PersistentVolumeItem[]>
  listPersistentVolumeClaims(
    context: string,
    namespace: string | null,
  ): Promise<PersistentVolumeClaimItem[]>
  listHelmReleases(context: string, namespace: string | null): Promise<HelmReleaseItem[]>
  listCustomResourceDefinitions(context: string): Promise<CustomResourceDefinitionItem[]>
  listCustomResources(context: string, namespace: string | null): Promise<CustomResourceItem[]>
  listCustomResourceType(
    context: string,
    namespace: string | null,
    resource: CustomResourceType,
  ): Promise<CustomResourceItem[]>
  deletePod(context: string, namespace: string, name: string): Promise<void>
  deleteResource(
    context: string,
    kind: string,
    namespace: string | null,
    name: string,
    apiVersion?: string,
  ): Promise<void>
  uninstallHelmRelease(context: string, namespace: string, name: string): Promise<void>
  cordonNode(context: string, name: string, cordoned: boolean): Promise<void>
  restartDeployment(context: string, namespace: string, name: string): Promise<void>
  restartWorkload(
    context: string,
    kind: ScalableWorkloadKind,
    namespace: string,
    name: string,
  ): Promise<void>
  scaleDeployment(context: string, namespace: string, name: string, replicas: number): Promise<void>
  getDeploymentEnv(
    context: string,
    kind: ScalableWorkloadKind,
    namespace: string,
    name: string,
  ): Promise<DeploymentEnvDetail>
  updateDeploymentContainerEnv(
    context: string,
    kind: ScalableWorkloadKind,
    namespace: string,
    name: string,
    containerType: DeploymentEnvContainerType,
    containerName: string,
    input: DeploymentEnvUpdateInput,
  ): Promise<void>
  getCronJobTriggerInfo(
    context: string,
    namespace: string,
    name: string,
  ): Promise<CronJobTriggerInfo>
  triggerCronJob(context: string, namespace: string, name: string, jobName: string): Promise<string>
  setCronJobSuspend(
    context: string,
    namespace: string,
    name: string,
    suspend: boolean,
  ): Promise<void>
  upsertConfigMapKey(
    context: string,
    namespace: string,
    name: string,
    key: string,
    value: string,
    source?: 'data' | 'binaryData',
  ): Promise<void>
  removeConfigMapKey(
    context: string,
    namespace: string,
    name: string,
    key: string,
    source: 'data' | 'binaryData',
  ): Promise<void>
  upsertSecretKey(
    context: string,
    namespace: string,
    name: string,
    key: string,
    value: string,
  ): Promise<void>
  removeSecretKey(context: string, namespace: string, name: string, key: string): Promise<void>
  getPodDetail(context: string, namespace: string, name: string): Promise<PodDetail>
  getNodeDetail(context: string, name: string): Promise<NodeDetail>
  getPodLogs(
    context: string,
    namespace: string,
    name: string,
    container: string | null,
    query?: LogQuery,
  ): Promise<WorkloadLogLine[]>
  getWorkloadSelector(
    context: string,
    kind: string,
    namespace: string,
    name: string,
  ): Promise<PodLabelSelector | null>
  startWorkloadLogStream(
    context: string,
    kind: string,
    namespace: string,
    name: string,
    query?: LogQuery,
  ): Promise<string>
  stopWorkloadLogStream(sessionId: string): Promise<void>
  getWorkloadPreviousLogs(
    context: string,
    kind: string,
    namespace: string,
    name: string,
    query?: LogQuery,
  ): Promise<WorkloadLogLine[]>
  onWorkloadLogEvent(cb: (payload: WorkloadLogEvent) => void): () => void
  getResourceYaml(
    context: string,
    kind: string,
    namespace: string | null,
    name: string,
    apiVersion?: string,
    plural?: string,
  ): Promise<string>
  applyResourceYaml(
    context: string,
    yamlText: string,
    expected: ApplyResourceIdentity,
  ): Promise<void>
  listEvents(
    context: string,
    namespace: string | null,
    involvedKind: string | null,
    involvedName: string | null,
    involvedApiVersion?: string | null,
    involvedUid?: string | null,
    eventType?: string | null,
  ): Promise<EventItem[]>
}
