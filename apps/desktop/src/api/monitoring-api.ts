export const monitoringApi = {
  atlasBindUptimeKumaInstance: (
    teamId: string,
    input: {
      label: string
      baseUrl: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ) => window.api.atlasBindUptimeKumaInstance(teamId, input),
  atlasUpdateUptimeKumaInstance: (
    teamId: string,
    instanceId: string,
    patch: {
      label?: string
      baseUrl?: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ) => window.api.atlasUpdateUptimeKumaInstance(teamId, instanceId, patch),
  atlasUnbindUptimeKumaInstance: (teamId: string, instanceId: string) =>
    window.api.atlasUnbindUptimeKumaInstance(teamId, instanceId),
  atlasListUptimeKumaMonitors: (teamId: string, instanceId: string) =>
    window.api.atlasListUptimeKumaMonitors(teamId, instanceId),
  atlasGetUptimeKumaMonitor: (teamId: string, instanceId: string, monitorId: number) =>
    window.api.atlasGetUptimeKumaMonitor(teamId, instanceId, monitorId),
  atlasCreateUptimeKumaMonitor: (
    teamId: string,
    instanceId: string,
    input: Record<string, unknown>,
  ) => window.api.atlasCreateUptimeKumaMonitor(teamId, instanceId, input),
  atlasUpdateUptimeKumaMonitor: (
    teamId: string,
    instanceId: string,
    monitorId: number,
    patch: Record<string, unknown>,
  ) => window.api.atlasUpdateUptimeKumaMonitor(teamId, instanceId, monitorId, patch),
  atlasPauseUptimeKumaMonitor: (teamId: string, instanceId: string, monitorId: number) =>
    window.api.atlasPauseUptimeKumaMonitor(teamId, instanceId, monitorId),
  atlasResumeUptimeKumaMonitor: (teamId: string, instanceId: string, monitorId: number) =>
    window.api.atlasResumeUptimeKumaMonitor(teamId, instanceId, monitorId),
  atlasGetMonitoringOverview: (teamId: string) => window.api.atlasGetMonitoringOverview(teamId),
  fileTransferUpload: (args: {
    teamId: string
    sessionId?: string
    filePaths: string[]
    label?: string
  }) => window.api.fileTransferUpload(args),
  fileTransferResolve: (args: { teamId: string; sessionId?: string; groupId: string }) =>
    window.api.fileTransferResolve(args),
  fileTransferListDownloads: (args: { teamId: string; sessionId?: string }) =>
    window.api.fileTransferListDownloads(args),
  fileTransferRevealInFolder: (path: string) => window.api.fileTransferRevealInFolder(path),
  readImageAttachment: (path: string) => window.api.readImageAttachment(path),
  attachmentDirectoryPaths: (paths: string[]) => window.api.attachmentDirectoryPaths(paths),
  fileTransferDownloadOne: (args: {
    teamId: string
    sessionId?: string
    groupId: string
    fileId: string
    fileName: string
  }) => window.api.fileTransferDownloadOne(args),
  fileTransferDownloadAllZip: (args: {
    teamId: string
    sessionId?: string
    groupId: string
    zipName: string
  }) => window.api.fileTransferDownloadAllZip(args),
  atlasDeleteBetterStackMonitor: (teamId: string, integrationId: string, monitorId: string) =>
    window.api.atlasDeleteBetterStackMonitor(teamId, integrationId, monitorId),
  atlasDeleteBetterStackHeartbeat: (teamId: string, integrationId: string, heartbeatId: string) =>
    window.api.atlasDeleteBetterStackHeartbeat(teamId, integrationId, heartbeatId),
  atlasDeleteUptimeKumaMonitor: (
    teamId: string,
    instanceId: string,
    monitorId: number,
    deleteChildren?: boolean,
  ) => window.api.atlasDeleteUptimeKumaMonitor(teamId, instanceId, monitorId, deleteChildren),
}
