import { probeCloudCli, probeCloudCliVersion } from '../agent/cloud-cli-probe'
import * as atlas from '../atlas'
import { requireNativeConsent } from '../consent'
import * as k8s from '../k8s'
import * as podExec from '../pod-exec'
import * as terminal from '../terminal'

import type { IpcMainInvokeEvent } from 'electron'

export const cloudOpsChannels = {
  'cloud:probeCliVersion': (_e: unknown, provider: string, probeId?: string) =>
    probeCloudCliVersion(provider, probeId),
  'cloud:probeCli': (_e: unknown, provider: string) => probeCloudCli(provider),
  'atlas:searchAwsLogGroupEvents': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    options: atlas.AwsLogSearchOptions,
    roleId?: string,
  ) => atlas.searchAwsLogGroupEvents(teamId, accountId, region, name, options, roleId),
  'atlas:listAwsLogStreams': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    nextToken?: string,
    roleId?: string,
  ) => atlas.listAwsLogStreams(teamId, accountId, region, name, nextToken, roleId),
  'atlas:setAwsLogGroupRetention': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    retentionDays: number | null,
    roleId?: string,
  ) => atlas.setAwsLogGroupRetention(teamId, accountId, region, name, retentionDays, roleId),
  'atlas:listAwsCloudWatchMetrics': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region: string,
    namespace?: string,
    metricName?: string,
    roleId?: string,
  ) => atlas.listAwsCloudWatchMetrics(teamId, accountId, region, namespace, metricName, roleId),
  'atlas:getAwsCloudWatchMetricData': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region: string,
    query: atlas.AwsCloudWatchMetricQuery,
    roleId?: string,
  ) => atlas.getAwsCloudWatchMetricData(teamId, accountId, region, query, roleId),
  'atlas:getAwsCloudWatchAlarmHistory': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => atlas.getAwsCloudWatchAlarmHistory(teamId, accountId, region, name, roleId),
  'atlas:listAwsLogGroups': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ) => atlas.listAwsLogGroups(teamId, accountId, region, roleId),
  'atlas:getAwsLogGroupEvents': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region: string,
    name: string,
    roleId?: string,
  ) => atlas.getAwsLogGroupEvents(teamId, accountId, region, name, roleId),
  'atlas:listAwsLightsailInstances': (
    _e: unknown,
    teamId: string,
    accountId: string,
    region?: string,
    roleId?: string,
  ) => atlas.listAwsLightsailInstances(teamId, accountId, region, roleId),
  'atlas:rebootAwsLightsailInstance': (
    _e: unknown,
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ) => atlas.rebootAwsLightsailInstance(teamId, accountId, name, region, roleId),
  'atlas:startAwsLightsailSsh': async (
    e: IpcMainInvokeEvent,
    teamId: string,
    accountId: string,
    name: string,
    region: string,
    roleId?: string,
  ) => {
    const access = await atlas.getAwsLightsailSshAccess(teamId, accountId, name, region, roleId)

    return terminal.startSshSession(e.sender, access)
  },
  'atlas:startAwsEc2Ssh': async (
    e: IpcMainInvokeEvent,
    teamId: string,
    accountId: string,
    instanceId: string,
    region?: string,
    username?: string,
    roleId?: string,
  ) => {
    const access = await atlas.getAwsEc2SshAccess(
      teamId,
      accountId,
      instanceId,
      region,
      username,
      roleId,
    )

    return terminal.startSshSession(e.sender, access)
  },
  'atlas:listGcpComputeInstances': (
    _e: unknown,
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => atlas.listGcpComputeInstances(teamId, projectId, serviceAccountId),
  'atlas:listGcpMetricDescriptors': (
    _e: unknown,
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => atlas.listGcpMetricDescriptors(teamId, projectId, serviceAccountId),
  'atlas:queryGcpMetricTimeSeries': (
    _e: unknown,
    teamId: string,
    projectId: string,
    query: atlas.GcpMetricTimeSeriesQuery,
    serviceAccountId?: string,
  ) => atlas.queryGcpMetricTimeSeries(teamId, projectId, query, serviceAccountId),
  'atlas:listGcpMonitoringDashboards': (
    _e: unknown,
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => atlas.listGcpMonitoringDashboards(teamId, projectId, serviceAccountId),
  'atlas:getGcpMonitoringDashboard': (
    _e: unknown,
    teamId: string,
    projectId: string,
    dashboardId: string,
    serviceAccountId?: string,
  ) => atlas.getGcpMonitoringDashboard(teamId, projectId, dashboardId, serviceAccountId),
  'atlas:queryGcpMonitoringDashboardWidget': (
    _e: unknown,
    teamId: string,
    projectId: string,
    dashboardId: string,
    widgetRef: string,
    query: atlas.GcpMonitoringDashboardWidgetQuery,
    serviceAccountId?: string,
  ) =>
    atlas.queryGcpMonitoringDashboardWidget(
      teamId,
      projectId,
      dashboardId,
      widgetRef,
      query,
      serviceAccountId,
    ),
  'atlas:listGcpCloudRunServices': (
    _e: unknown,
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => atlas.listGcpCloudRunServices(teamId, projectId, serviceAccountId),
  'atlas:startGcpComputeSsh': async (
    e: IpcMainInvokeEvent,
    teamId: string,
    projectId: string,
    name: string,
    zone: string,
    serviceAccountId?: string,
  ) => {
    const access = await atlas.getGcpComputeSshAccess(
      teamId,
      projectId,
      name,
      zone,
      serviceAccountId,
    )

    return terminal.startSshSession(e.sender, access)
  },
  'ssh-terminal:input': (_e: unknown, id: string, data: string) =>
    terminal.writeSshSession(id, data),
  'ssh-terminal:replay': (e: IpcMainInvokeEvent, id: string) =>
    terminal.replaySshSession(e.sender, id),
  'ssh-terminal:close': (_e: unknown, id: string) => terminal.closeSshSession(id),
  'pod-exec:start': (
    e: IpcMainInvokeEvent,
    id: string,
    ctx: string,
    ns: string,
    pod: string,
    container: string,
    opts?: { cols?: number; rows?: number; shell?: string },
  ) => podExec.startPodExecSession(e.sender, id, k8s.getKubeConfig(ctx), ns, pod, container, opts),
  'node-exec:start': async (
    e: IpcMainInvokeEvent,
    id: string,
    ctx: string,
    node: string,
    opts?: { cols?: number; rows?: number },
  ) => {
    // Reattaching to the shell this window already has open is not a new
    // privileged operation — the pod exists and was consented to. Prompting
    // again every time the dock swaps chat session would train the user to
    // click through the one dialog that matters.
    if (podExec.hasPodExecSession(id)) return { id }
    // Real security boundary for the node root shell: a privileged pod with
    // host PID/IPC/network and the node's root filesystem. The renderer's
    // in-app explainer is UX; this native prompt is what a rogue renderer
    // can't click through. See electron/consent.ts.
    const ok = await requireNativeConsent(e.sender, {
      title: 'Open a root shell on this node?',
      message: `Start a privileged shell on node "${node}"?`,
      detail:
        'This creates a privileged pod with full access to the node — host PID namespace and the node root filesystem. Only continue if you started this.',
      confirmLabel: 'Open shell',
    })

    if (!ok) throw new Error('Node shell cancelled — confirmation declined.')

    return podExec.startNodeExecSession(
      e.sender,
      id,
      k8s.getKubeConfig(ctx),
      k8s.getCoreApi(ctx),
      node,
      opts,
    )
  },
  'pod-exec:has-session': (_e: unknown, id: string) => podExec.hasPodExecSession(id),
  'pod-exec:detach': (_e: unknown, id: string) => podExec.detachPodExecSession(id),
  'pod-exec:close-tab-scope': (_e: unknown, tabId: string, scope: string | null) =>
    podExec.closeSessionsOutsideScope(tabId, scope),
  'pod-exec:input': (_e: unknown, id: string, data: string) =>
    podExec.writePodExecSession(id, data),
  'pod-exec:resize': (_e: unknown, id: string, cols: number, rows: number) =>
    podExec.resizePodExecSession(id, cols, rows),
  'pod-exec:replay': (e: IpcMainInvokeEvent, id: string) =>
    podExec.replayPodExecSession(e.sender, id),
  'pod-exec:close': (_e: unknown, id: string) => podExec.closePodExecSession(id),
} as const
