import type { ApplyResourceIdentity, ScalableWorkloadKind } from './app-types.ts'
import type { WorkloadLogEvent } from './watch-types.ts'
import type { DeploymentEnvContainerType, DeploymentEnvUpdateInput } from '../types/k8s-core.ts'
import type { CustomResourceType } from '../types/k8s-resources.ts'
import type { LogQuery } from '../types/k8s-workloads.ts'

export const k8sApi = {
  listContexts: () => window.api.listContexts(),
  probeClusterAccess: (ctx: string) => window.api.probeClusterAccess(ctx),
  listNamespaceNames: (ctx: string) => window.api.listNamespaceNames(ctx),
  listNamespaces: (ctx: string) => window.api.listNamespaces(ctx),
  listPods: (ctx: string, ns?: string) => window.api.listPods(ctx, ns ?? null),
  listDeployments: (ctx: string, ns?: string) => window.api.listDeployments(ctx, ns ?? null),
  listNodes: (ctx: string) => window.api.listNodes(ctx),
  listContainerUsage: (ctx: string) => window.api.listContainerUsage(ctx),
  listServices: (ctx: string, ns?: string) => window.api.listServices(ctx, ns ?? null),
  listReplicaSets: (ctx: string, ns?: string) => window.api.listReplicaSets(ctx, ns ?? null),
  listStatefulSets: (ctx: string, ns?: string) => window.api.listStatefulSets(ctx, ns ?? null),
  listDaemonSets: (ctx: string, ns?: string) => window.api.listDaemonSets(ctx, ns ?? null),
  listJobs: (ctx: string, ns?: string) => window.api.listJobs(ctx, ns ?? null),
  listCronJobs: (ctx: string, ns?: string) => window.api.listCronJobs(ctx, ns ?? null),
  getCronJobDetail: (ctx: string, ns: string, name: string) =>
    window.api.getCronJobDetail(ctx, ns, name),
  listIngresses: (ctx: string, ns?: string) => window.api.listIngresses(ctx, ns ?? null),
  listNetworkPolicies: (ctx: string, ns?: string) =>
    window.api.listNetworkPolicies(ctx, ns ?? null),
  listEndpointSlices: (ctx: string, ns?: string) => window.api.listEndpointSlices(ctx, ns ?? null),
  listConfigMaps: (ctx: string, ns?: string) => window.api.listConfigMaps(ctx, ns ?? null),
  listSecrets: (ctx: string, ns?: string) => window.api.listSecrets(ctx, ns ?? null),
  listStorageClasses: (ctx: string) => window.api.listStorageClasses(ctx),
  listServiceAccounts: (ctx: string, ns?: string) =>
    window.api.listServiceAccounts(ctx, ns ?? null),
  listRoles: (ctx: string, ns?: string) => window.api.listRoles(ctx, ns ?? null),
  listRoleBindings: (ctx: string, ns?: string) => window.api.listRoleBindings(ctx, ns ?? null),
  listClusterRoles: (ctx: string) => window.api.listClusterRoles(ctx),
  listClusterRoleBindings: (ctx: string) => window.api.listClusterRoleBindings(ctx),
  listPersistentVolumes: (ctx: string) => window.api.listPersistentVolumes(ctx),
  listPersistentVolumeClaims: (ctx: string, ns?: string) =>
    window.api.listPersistentVolumeClaims(ctx, ns ?? null),
  listHelmReleases: (ctx: string, ns?: string) => window.api.listHelmReleases(ctx, ns ?? null),
  listCustomResourceDefinitions: (ctx: string) => window.api.listCustomResourceDefinitions(ctx),
  listCustomResources: (ctx: string, ns?: string) =>
    window.api.listCustomResources(ctx, ns ?? null),
  listCustomResourceType: (ctx: string, ns: string | null, resource: CustomResourceType) =>
    window.api.listCustomResourceType(ctx, ns, resource),
  deletePod: (ctx: string, ns: string, name: string) => window.api.deletePod(ctx, ns, name),
  deleteResource: (
    ctx: string,
    kind: string,
    ns: string | null,
    name: string,
    apiVersion?: string,
  ) => window.api.deleteResource(ctx, kind, ns, name, apiVersion),
  uninstallHelmRelease: (ctx: string, ns: string, name: string) =>
    window.api.uninstallHelmRelease(ctx, ns, name),
  cordonNode: (ctx: string, name: string, cordoned: boolean) =>
    window.api.cordonNode(ctx, name, cordoned),
  restartDeployment: (ctx: string, ns: string, name: string) =>
    window.api.restartDeployment(ctx, ns, name),
  restartWorkload: (ctx: string, kind: ScalableWorkloadKind, ns: string, name: string) =>
    window.api.restartWorkload(ctx, kind, ns, name),
  scaleDeployment: (ctx: string, ns: string, name: string, replicas: number) =>
    window.api.scaleDeployment(ctx, ns, name, replicas),
  getDeploymentEnv: (ctx: string, kind: ScalableWorkloadKind, ns: string, name: string) =>
    window.api.getDeploymentEnv(ctx, kind, ns, name),
  updateDeploymentContainerEnv: (
    ctx: string,
    kind: ScalableWorkloadKind,
    ns: string,
    name: string,
    containerType: DeploymentEnvContainerType,
    containerName: string,
    input: DeploymentEnvUpdateInput,
  ) =>
    window.api.updateDeploymentContainerEnv(
      ctx,
      kind,
      ns,
      name,
      containerType,
      containerName,
      input,
    ),
  getCronJobTriggerInfo: (ctx: string, ns: string, name: string) =>
    window.api.getCronJobTriggerInfo(ctx, ns, name),
  triggerCronJob: (ctx: string, ns: string, name: string, jobName: string) =>
    window.api.triggerCronJob(ctx, ns, name, jobName),
  setCronJobSuspend: (ctx: string, ns: string, name: string, suspend: boolean) =>
    window.api.setCronJobSuspend(ctx, ns, name, suspend),
  upsertConfigMapKey: (
    ctx: string,
    ns: string,
    name: string,
    key: string,
    value: string,
    source: 'data' | 'binaryData' = 'data',
  ) => window.api.upsertConfigMapKey(ctx, ns, name, key, value, source),
  removeConfigMapKey: (
    ctx: string,
    ns: string,
    name: string,
    key: string,
    source: 'data' | 'binaryData',
  ) => window.api.removeConfigMapKey(ctx, ns, name, key, source),
  upsertSecretKey: (ctx: string, ns: string, name: string, key: string, value: string) =>
    window.api.upsertSecretKey(ctx, ns, name, key, value),
  removeSecretKey: (ctx: string, ns: string, name: string, key: string) =>
    window.api.removeSecretKey(ctx, ns, name, key),
  getPodDetail: (ctx: string, ns: string, name: string) => window.api.getPodDetail(ctx, ns, name),
  getNodeDetail: (ctx: string, name: string) => window.api.getNodeDetail(ctx, name),
  getPodLogs: (
    ctx: string,
    ns: string,
    name: string,
    container: string | null,
    query: LogQuery = { tailLines: 500 },
  ) => window.api.getPodLogs(ctx, ns, name, container, query),
  getWorkloadSelector: (ctx: string, kind: string, ns: string, name: string) =>
    window.api.getWorkloadSelector(ctx, kind, ns, name),
  startWorkloadLogStream: (
    ctx: string,
    kind: string,
    ns: string,
    name: string,
    query: LogQuery = { tailLines: 200 },
  ) => window.api.startWorkloadLogStream(ctx, kind, ns, name, query),
  stopWorkloadLogStream: (sessionId: string) => window.api.stopWorkloadLogStream(sessionId),
  getWorkloadPreviousLogs: (
    ctx: string,
    kind: string,
    ns: string,
    name: string,
    query: LogQuery = { tailLines: 200 },
  ) => window.api.getWorkloadPreviousLogs(ctx, kind, ns, name, query),
  onWorkloadLogEvent: (cb: (payload: WorkloadLogEvent) => void) =>
    window.api.onWorkloadLogEvent(cb),
  getResourceYaml: (
    ctx: string,
    kind: string,
    ns: string | null,
    name: string,
    apiVersion?: string,
    plural?: string,
  ) => window.api.getResourceYaml(ctx, kind, ns, name, apiVersion, plural),
  applyResourceYaml: (ctx: string, yamlText: string, expected: ApplyResourceIdentity) =>
    window.api.applyResourceYaml(ctx, yamlText, expected),
  listEvents: (
    ctx: string,
    ns: string | null,
    involvedKind: string | null,
    involvedName: string | null,
    involvedApiVersion?: string | null,
    involvedUid?: string | null,
    eventType?: string | null,
  ) =>
    window.api.listEvents(
      ctx,
      ns,
      involvedKind,
      involvedName,
      involvedApiVersion,
      involvedUid,
      eventType,
    ),
}
