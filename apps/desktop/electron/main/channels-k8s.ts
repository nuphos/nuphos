import { dangerousManifestReason, requireNativeConsent } from '../consent'
import * as k8s from '../k8s'
import * as k8sWatch from '../k8s-watch'

import { withCapture } from './capture'

import type { IpcMainInvokeEvent } from 'electron'

export const k8sChannels = {
  'k8s:listContexts': () => k8s.listContexts(),
  'k8s:probeClusterAccess': (_e: unknown, ctx: string) => k8s.probeClusterAccess(ctx),
  'k8s:listNamespaceNames': (_e: unknown, ctx: string) => k8s.listNamespaceNames(ctx),
  'k8s:listNamespaces': (_e: unknown, ctx: string) => k8s.listNamespaces(ctx),
  'k8s:listPods': (_e: unknown, ctx: string, ns: string | null) => k8s.listPods(ctx, ns),
  'k8s:listDeployments': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listDeployments(ctx, ns),
  'k8s:listNodes': (_e: unknown, ctx: string) => k8s.listNodes(ctx),
  'k8s:listContainerUsage': (_e: unknown, ctx: string) => k8s.listContainerUsage(ctx),
  'k8s:listServices': (_e: unknown, ctx: string, ns: string | null) => k8s.listServices(ctx, ns),
  'k8s:listReplicaSets': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listReplicaSets(ctx, ns),
  'k8s:listStatefulSets': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listStatefulSets(ctx, ns),
  'k8s:listDaemonSets': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listDaemonSets(ctx, ns),
  'k8s:listJobs': (_e: unknown, ctx: string, ns: string | null) => k8s.listJobs(ctx, ns),
  'k8s:listCronJobs': (_e: unknown, ctx: string, ns: string | null) => k8s.listCronJobs(ctx, ns),
  'k8s:getCronJobDetail': (_e: unknown, ctx: string, ns: string, name: string) =>
    k8s.getCronJobDetail(ctx, ns, name),
  'k8s:listIngresses': (_e: unknown, ctx: string, ns: string | null) => k8s.listIngresses(ctx, ns),
  'k8s:listNetworkPolicies': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listNetworkPolicies(ctx, ns),
  'k8s:listEndpointSlices': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listEndpointSlices(ctx, ns),
  'k8s:listConfigMaps': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listConfigMaps(ctx, ns),
  'k8s:listSecrets': (_e: unknown, ctx: string, ns: string | null) => k8s.listSecrets(ctx, ns),
  'k8s:listStorageClasses': (_e: unknown, ctx: string) => k8s.listStorageClasses(ctx),
  'k8s:listServiceAccounts': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listServiceAccounts(ctx, ns),
  'k8s:listRoles': (_e: unknown, ctx: string, ns: string | null) => k8s.listRoles(ctx, ns),
  'k8s:listRoleBindings': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listRoleBindings(ctx, ns),
  'k8s:listClusterRoles': (_e: unknown, ctx: string) => k8s.listClusterRoles(ctx),
  'k8s:listClusterRoleBindings': (_e: unknown, ctx: string) => k8s.listClusterRoleBindings(ctx),
  'k8s:listPersistentVolumes': (_e: unknown, ctx: string) => k8s.listPersistentVolumes(ctx),
  'k8s:listPersistentVolumeClaims': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listPersistentVolumeClaims(ctx, ns),
  'k8s:listHelmReleases': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listHelmReleases(ctx, ns),
  'k8s:listCustomResourceDefinitions': (_e: unknown, ctx: string) =>
    k8s.listCustomResourceDefinitions(ctx),
  'k8s:listCustomResources': (_e: unknown, ctx: string, ns: string | null) =>
    k8s.listCustomResources(ctx, ns),
  'k8s:listCustomResourceType': (
    _e: unknown,
    ctx: string,
    ns: string | null,
    resource: k8s.CustomResourceDescriptor,
  ) => k8s.listCustomResourceType(ctx, ns, resource),
  'k8s:deletePod': (_e: unknown, ctx: string, ns: string, name: string) =>
    withCapture('pod_deleted', () => k8s.deletePod(ctx, ns, name)),
  'k8s:deleteResource': (
    _e: unknown,
    ctx: string,
    kind: string,
    ns: string | null,
    name: string,
    apiVersion?: string,
  ) =>
    withCapture('k8s_resource_deleted', () => k8s.deleteResource(ctx, kind, ns, name, apiVersion), {
      kind,
      namespaced: ns !== null,
    }),
  'k8s:uninstallHelmRelease': (_e: unknown, ctx: string, ns: string, name: string) =>
    withCapture('helm_release_uninstalled', () => k8s.uninstallHelmRelease(ctx, ns, name)),
  'k8s:cordonNode': (_e: unknown, ctx: string, name: string, cordoned: boolean) =>
    withCapture('node_cordoned', () => k8s.cordonNode(ctx, name, cordoned), { cordoned }),
  'k8s:restartDeployment': (_e: unknown, ctx: string, ns: string, name: string) =>
    withCapture('deployment_restarted', () => k8s.restartDeployment(ctx, ns, name)),
  'k8s:restartWorkload': (
    _e: unknown,
    ctx: string,
    kind: k8s.RestartableWorkloadKind,
    ns: string,
    name: string,
  ) => withCapture('workload_restarted', () => k8s.restartWorkload(ctx, kind, ns, name)),
  'k8s:scaleDeployment': (_e: unknown, ctx: string, ns: string, name: string, replicas: number) =>
    withCapture('deployment_scaled', () => k8s.scaleDeployment(ctx, ns, name, replicas), {
      replicas,
    }),
  'k8s:getDeploymentEnv': (
    _e: unknown,
    ctx: string,
    kind: k8s.EditableWorkloadEnvKind,
    ns: string,
    name: string,
  ) => k8s.getDeploymentEnv(ctx, kind, ns, name),
  'k8s:updateDeploymentContainerEnv': (
    _e: unknown,
    ctx: string,
    kind: k8s.EditableWorkloadEnvKind,
    ns: string,
    name: string,
    containerType: 'containers' | 'initContainers',
    containerName: string,
    input: k8s.DeploymentEnvUpdateInput,
  ) =>
    withCapture(
      'workload_env_updated',
      () =>
        k8s.updateDeploymentContainerEnv(ctx, kind, ns, name, containerType, containerName, input),
      { kind, containerType },
    ),
  'k8s:getCronJobTriggerInfo': (_e: unknown, ctx: string, ns: string, name: string) =>
    k8s.getCronJobTriggerInfo(ctx, ns, name),
  'k8s:triggerCronJob': (_e: unknown, ctx: string, ns: string, name: string, jobName: string) =>
    withCapture('cronjob_triggered', () => k8s.triggerCronJob(ctx, ns, name, jobName)),
  'k8s:setCronJobSuspend': (_e: unknown, ctx: string, ns: string, name: string, suspend: boolean) =>
    withCapture('cronjob_suspend_set', () => k8s.setCronJobSuspend(ctx, ns, name, suspend), {
      suspend,
    }),
  'k8s:upsertConfigMapKey': (
    _e: unknown,
    ctx: string,
    ns: string,
    name: string,
    key: string,
    value: string,
    source: 'data' | 'binaryData' = 'data',
  ) => k8s.upsertConfigMapKey(ctx, ns, name, key, value, source),
  'k8s:removeConfigMapKey': (
    _e: unknown,
    ctx: string,
    ns: string,
    name: string,
    key: string,
    source: 'data' | 'binaryData',
  ) => k8s.removeConfigMapKey(ctx, ns, name, key, source),
  'k8s:upsertSecretKey': (
    _e: unknown,
    ctx: string,
    ns: string,
    name: string,
    key: string,
    value: string,
  ) => k8s.upsertSecretKey(ctx, ns, name, key, value),
  'k8s:removeSecretKey': (_e: unknown, ctx: string, ns: string, name: string, key: string) =>
    k8s.removeSecretKey(ctx, ns, name, key),
  'k8s:getPodDetail': (_e: unknown, ctx: string, ns: string, name: string) =>
    k8s.getPodDetail(ctx, ns, name),
  'k8s:getNodeDetail': (_e: unknown, ctx: string, name: string) => k8s.getNodeDetail(ctx, name),
  'k8s:getPodLogs': (
    _e: unknown,
    ctx: string,
    ns: string,
    name: string,
    container: string | null,
    query: k8s.LogQuery,
  ) => k8s.getPodLogs(ctx, ns, name, container, query),
  'k8s:getWorkloadSelector': (_e: unknown, ctx: string, kind: string, ns: string, name: string) =>
    k8s.getWorkloadSelector(ctx, kind, ns, name),
  'k8s:startWorkloadLogStream': (
    event: IpcMainInvokeEvent,
    ctx: string,
    kind: string,
    ns: string,
    name: string,
    query: k8s.LogQuery,
  ) => k8s.startWorkloadLogStream(ctx, kind, ns, name, query, event.sender),
  'k8s:stopWorkloadLogStream': (_e: unknown, sessionId: string) =>
    k8s.stopWorkloadLogStream(sessionId),
  'k8s:getWorkloadPreviousLogs': (
    _e: unknown,
    ctx: string,
    kind: string,
    ns: string,
    name: string,
    query: k8s.LogQuery,
  ) => k8s.getWorkloadPreviousLogs(ctx, kind, ns, name, query),
  'k8s:getResourceYaml': (
    _e: unknown,
    ctx: string,
    kind: string,
    ns: string | null,
    name: string,
    apiVersion?: string,
    plural?: string,
  ) => k8s.getResourceYaml(ctx, kind, ns, name, apiVersion, plural),
  'k8s:applyResourceYaml': async (
    e: IpcMainInvokeEvent,
    ctx: string,
    yamlText: string,
    expected: k8s.ApplyResourceIdentity,
  ) => {
    // Native consent only for manifests that grant node/cluster-level power
    // (privileged pod, host namespace, hostPath, RBAC). Ordinary config edits
    // apply without a prompt. See electron/consent.ts.
    const reason = dangerousManifestReason(yamlText)

    if (reason) {
      const ok = await requireNativeConsent(e.sender, {
        title: 'Apply privileged resource?',
        message: `Apply ${expected.kind} "${expected.name}" to "${ctx}"?`,
        detail: `This manifest ${reason}. A compromised app window could use this to take over the cluster — only continue if you started this apply.`,
        confirmLabel: 'Apply',
      })

      if (!ok) throw new Error('Apply cancelled — confirmation declined.')
    }

    return k8s.applyResourceYaml(ctx, yamlText, expected)
  },
  'k8s:listEvents': (
    _e: unknown,
    ctx: string,
    ns: string | null,
    involvedKind: string | null,
    involvedName: string | null,
    involvedApiVersion?: string | null,
    involvedUid?: string | null,
    eventType?: string | null,
  ) =>
    k8s.listEvents(
      ctx,
      ns,
      involvedKind,
      involvedName,
      involvedApiVersion ?? null,
      involvedUid ?? null,
      eventType ?? null,
    ),
  'k8s:startPortForward': (
    _e: unknown,
    ctx: string,
    ns: string,
    pod: string,
    targetPort: number,
    localPort?: number,
  ) => k8s.startPortForward(ctx, ns, pod, targetPort, localPort),
  'k8s:startServicePortForward': (
    _e: unknown,
    ctx: string,
    ns: string,
    service: string,
    servicePort: number,
    localPort?: number,
  ) => k8s.startServicePortForward(ctx, ns, service, servicePort, localPort),
  'k8s:getPodPortForwardOptions': (_e: unknown, ctx: string, ns: string, pod: string) =>
    k8s.getPodPortForwardOptions(ctx, ns, pod),
  'k8s:getServicePortForwardOptions': (_e: unknown, ctx: string, ns: string, service: string) =>
    k8s.getServicePortForwardOptions(ctx, ns, service),
  'k8s:stopPortForward': (_e: unknown, id: string) => k8s.stopPortForward(id),
  'k8s:listPortForwards': () => k8s.listPortForwards(),
  'k8s:watch:subscribe': (
    e: IpcMainInvokeEvent,
    args: { context: string; kind: k8sWatch.WatchKind; namespace: string | null },
  ) => k8sWatch.subscribe(e.sender, args.context, args.kind, args.namespace),
  'k8s:watch:unsubscribe': (_e: unknown, subscriptionId: string) =>
    k8sWatch.unsubscribe(subscriptionId),
  'k8s:watch:refresh': (
    _e: unknown,
    args: { context: string; kind: k8sWatch.WatchKind; namespace: string | null },
  ) => k8sWatch.refresh(args.context, args.kind, args.namespace),
} as const
