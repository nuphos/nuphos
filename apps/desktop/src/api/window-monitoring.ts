import type { FileTransferGroup, MonitoringOverview } from '../types/app-misc.ts'
import type { UptimeKumaInstance, UptimeKumaMonitor } from '../types/infra-integrations.ts'

export type WindowMonitoringApi = {
  atlasBindUptimeKumaInstance(
    teamId: string,
    input: {
      label: string
      baseUrl: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ): Promise<UptimeKumaInstance>
  atlasUpdateUptimeKumaInstance(
    teamId: string,
    instanceId: string,
    patch: {
      label?: string
      baseUrl?: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ): Promise<UptimeKumaInstance>
  atlasUnbindUptimeKumaInstance(teamId: string, instanceId: string): Promise<void>
  atlasListUptimeKumaMonitors(teamId: string, instanceId: string): Promise<UptimeKumaMonitor[]>
  atlasGetUptimeKumaMonitor(
    teamId: string,
    instanceId: string,
    monitorId: number,
  ): Promise<UptimeKumaMonitor>
  atlasCreateUptimeKumaMonitor(
    teamId: string,
    instanceId: string,
    input: Record<string, unknown>,
  ): Promise<{ monitorID?: number; monitor?: UptimeKumaMonitor }>
  atlasUpdateUptimeKumaMonitor(
    teamId: string,
    instanceId: string,
    monitorId: number,
    patch: Record<string, unknown>,
  ): Promise<UptimeKumaMonitor>
  atlasPauseUptimeKumaMonitor(teamId: string, instanceId: string, monitorId: number): Promise<void>
  atlasResumeUptimeKumaMonitor(teamId: string, instanceId: string, monitorId: number): Promise<void>
  atlasGetMonitoringOverview(teamId: string): Promise<MonitoringOverview>
  fileTransferUpload(args: {
    teamId: string
    sessionId?: string
    filePaths: string[]
    label?: string
  }): Promise<FileTransferGroup>
  fileTransferResolve(args: {
    teamId: string
    sessionId?: string
    groupId: string
  }): Promise<FileTransferGroup>
  fileTransferListDownloads(args: {
    teamId: string
    sessionId?: string
  }): Promise<{ groups: FileTransferGroup[] }>
  fileTransferRevealInFolder(path: string): Promise<void>
  readImageAttachment(
    path: string,
  ): Promise<{ mediaType: string; url: string; fileName: string; attachmentId: string } | null>
  attachmentDirectoryPaths(paths: string[]): Promise<string[]>
  fileTransferDownloadOne(args: {
    teamId: string
    sessionId?: string
    groupId: string
    fileId: string
    fileName: string
  }): Promise<{ saved: boolean; path?: string }>
  fileTransferDownloadAllZip(args: {
    teamId: string
    sessionId?: string
    groupId: string
    zipName: string
  }): Promise<{ saved: boolean; path?: string; count?: number; skipped?: number }>
  atlasDeleteBetterStackMonitor(
    teamId: string,
    integrationId: string,
    monitorId: string,
  ): Promise<void>
  atlasDeleteBetterStackHeartbeat(
    teamId: string,
    integrationId: string,
    heartbeatId: string,
  ): Promise<void>
  atlasDeleteUptimeKumaMonitor(
    teamId: string,
    instanceId: string,
    monitorId: number,
    deleteChildren?: boolean,
  ): Promise<void>
}
