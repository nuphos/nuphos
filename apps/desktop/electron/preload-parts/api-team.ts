import { ipcRenderer } from 'electron'

import { runtimeApi } from './api-runtimes'

import type { DashboardViewRange } from '../../src/dashboards/schema'
import type { AgentProvider } from '../../src/types/runtime'

export const teamApi = {
  ...runtimeApi,
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => cb(state)

    ipcRenderer.on('updater:status', handler)

    return () => ipcRenderer.off('updater:status', handler)
  },
  changelogGetState: () => ipcRenderer.invoke('changelog:getState'),
  onChangelogStatus: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => cb(state)

    ipcRenderer.on('changelog:status', handler)

    return () => ipcRenderer.off('changelog:status', handler)
  },
  atlasListTeams: () => ipcRenderer.invoke('atlas:listTeams'),
  atlasGetSidebarFavorites: (teamId: string) =>
    ipcRenderer.invoke('atlas:getSidebarFavorites', teamId),
  atlasPutSidebarFavorites: (teamId: string, entries: unknown[], expectedRevision: number) =>
    ipcRenderer.invoke('atlas:putSidebarFavorites', teamId, entries, expectedRevision),
  atlasGetHomeLayout: (teamId: string) => ipcRenderer.invoke('atlas:getHomeLayout', teamId),
  atlasGetTeamActivity: (teamId: string, range: string) =>
    ipcRenderer.invoke('atlas:getTeamActivity', teamId, range),
  atlasPutHomeLayout: (teamId: string, scope: 'personal' | 'team', layout: unknown) =>
    ipcRenderer.invoke('atlas:putHomeLayout', teamId, scope, layout),
  archListDiagrams: (teamId: string) => ipcRenderer.invoke('arch:listDiagrams', teamId),
  archGetDiagram: (teamId: string, diagramId: string) =>
    ipcRenderer.invoke('arch:getDiagram', teamId, diagramId),
  archCreateDiagram: (teamId: string, name: string) =>
    ipcRenderer.invoke('arch:createDiagram', teamId, name),
  archSaveDiagram: (teamId: string, diagramId: string, patch: unknown) =>
    ipcRenderer.invoke('arch:saveDiagram', teamId, diagramId, patch),
  archDeleteDiagram: (teamId: string, diagramId: string) =>
    ipcRenderer.invoke('arch:deleteDiagram', teamId, diagramId),
  // --- Dashboards ---
  dashboardsList: (teamId: string) => ipcRenderer.invoke('dashboards:list', teamId),
  dashboardsCreate: (teamId: string, input: unknown) =>
    ipcRenderer.invoke('dashboards:create', teamId, input),
  dashboardsGet: (teamId: string, dashboardId: string, viewRange?: DashboardViewRange) =>
    ipcRenderer.invoke('dashboards:get', teamId, dashboardId, viewRange),
  dashboardsUpdate: (teamId: string, dashboardId: string, input: unknown) =>
    ipcRenderer.invoke('dashboards:update', teamId, dashboardId, input),
  dashboardsDelete: (teamId: string, dashboardId: string) =>
    ipcRenderer.invoke('dashboards:delete', teamId, dashboardId),
  dashboardsRefresh: (
    teamId: string,
    dashboardId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) => ipcRenderer.invoke('dashboards:refresh', teamId, dashboardId, force, viewRange),
  dashboardsCreatePanel: (teamId: string, dashboardId: string, input: unknown) =>
    ipcRenderer.invoke('dashboards:createPanel', teamId, dashboardId, input),
  dashboardsUpdatePanel: (teamId: string, dashboardId: string, panelId: string, input: unknown) =>
    ipcRenderer.invoke('dashboards:updatePanel', teamId, dashboardId, panelId, input),
  dashboardsDeletePanel: (teamId: string, dashboardId: string, panelId: string) =>
    ipcRenderer.invoke('dashboards:deletePanel', teamId, dashboardId, panelId),
  dashboardsExecutePanel: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) =>
    ipcRenderer.invoke('dashboards:executePanel', teamId, dashboardId, panelId, force, viewRange),
  dashboardsGenerateInsight: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    viewRange?: DashboardViewRange,
  ) => ipcRenderer.invoke('dashboards:generateInsight', teamId, dashboardId, panelId, viewRange),
  dashboardsInsightFeedback: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    rating: 'up' | 'down',
    note?: string,
    viewRange?: DashboardViewRange,
  ) =>
    ipcRenderer.invoke(
      'dashboards:insightFeedback',
      teamId,
      dashboardId,
      panelId,
      rating,
      note,
      viewRange,
    ),
  dashboardsGetAlert: (teamId: string, dashboardId: string, panelId: string) =>
    ipcRenderer.invoke('dashboards:getAlert', teamId, dashboardId, panelId),
  dashboardsSaveAlert: (teamId: string, dashboardId: string, panelId: string, input: unknown) =>
    ipcRenderer.invoke('dashboards:saveAlert', teamId, dashboardId, panelId, input),
  dashboardsDeleteAlert: (teamId: string, dashboardId: string, panelId: string) =>
    ipcRenderer.invoke('dashboards:deleteAlert', teamId, dashboardId, panelId),
  teamSkillsGetManifest: (teamId: string) => ipcRenderer.invoke('teamSkills:getManifest', teamId),
  teamSkillsListObjects: (teamId: string) => ipcRenderer.invoke('teamSkills:listObjects', teamId),
  teamSkillsGetObject: (teamId: string, key: string) =>
    ipcRenderer.invoke('teamSkills:getObject', teamId, key),
  teamSkillsGetHistory: (teamId: string, name: string) =>
    ipcRenderer.invoke('teamSkills:getHistory', teamId, name),
  teamSkillsPutObject: (
    teamId: string,
    key: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
  ) => ipcRenderer.invoke('teamSkills:putObject', teamId, key, file),
  teamSkillsListLocal: () => ipcRenderer.invoke('teamSkills:listLocal'),
  teamSkillsImportLocal: (teamId: string, skillId: string) =>
    ipcRenderer.invoke('teamSkills:importLocal', teamId, skillId),
  teamSkillsDeleteObject: (teamId: string, key: string) =>
    ipcRenderer.invoke('teamSkills:deleteObject', teamId, key),
  teamSkillsDeleteSkill: (teamId: string, name: string) =>
    ipcRenderer.invoke('teamSkills:deleteSkill', teamId, name),
  atlasCreateTeam: (name: string) => ipcRenderer.invoke('atlas:createTeam', name),
  atlasUpdateTeam: (teamId: string, input: { name?: string; avatarUrl?: string }) =>
    ipcRenderer.invoke('atlas:updateTeam', teamId, input),
  atlasSetTeamEmailDomainDiscovery: (teamId: string, enabled: boolean) =>
    ipcRenderer.invoke('atlas:setTeamEmailDomainDiscovery', teamId, enabled),
  atlasSetTeamAgentRuntime: (teamId: string, runtime: AgentProvider) =>
    ipcRenderer.invoke('atlas:setTeamAgentRuntime', teamId, runtime),
  atlasListDiscoverableTeams: () => ipcRenderer.invoke('atlas:listDiscoverableTeams'),
  atlasJoinDiscoverableTeam: (teamId: string) =>
    ipcRenderer.invoke('atlas:joinDiscoverableTeam', teamId),
  atlasListTeamMembers: (teamId: string, includeRemoved?: boolean) =>
    ipcRenderer.invoke('atlas:listTeamMembers', teamId, includeRemoved),
  atlasListTeamInvitations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listTeamInvitations', teamId),
  atlasCancelTeamInvitation: (teamId: string, invitationId: string) =>
    ipcRenderer.invoke('atlas:cancelTeamInvitation', teamId, invitationId),
  atlasRemoveTeamMember: (teamId: string, memberId: string) =>
    ipcRenderer.invoke('atlas:removeTeamMember', teamId, memberId),
  atlasDeleteTeam: (teamId: string) => ipcRenderer.invoke('atlas:deleteTeam', teamId),
  atlasLeaveTeam: (teamId: string) => ipcRenderer.invoke('atlas:leaveTeam', teamId),
  atlasUpdateTeamMemberRole: (teamId: string, memberId: string, role: string) =>
    ipcRenderer.invoke('atlas:updateTeamMemberRole', teamId, memberId, role),
  atlasListMyInvitations: () => ipcRenderer.invoke('atlas:listMyInvitations'),
  atlasInviteTeamMember: (teamId: string, inviteeEmail: string) =>
    ipcRenderer.invoke('atlas:inviteTeamMember', teamId, inviteeEmail),
  atlasAcceptInvitation: (invitationId: string) =>
    ipcRenderer.invoke('atlas:acceptInvitation', invitationId),
  atlasRejectInvitation: (invitationId: string) =>
    ipcRenderer.invoke('atlas:rejectInvitation', invitationId),
  atlasListSlackChannelMappings: (teamId: string) =>
    ipcRenderer.invoke('atlas:listSlackChannelMappings', teamId),
  atlasGetSlackConnectionStatus: (teamId: string) =>
    ipcRenderer.invoke('atlas:getSlackConnectionStatus', teamId),
  atlasGetSlackInstallation: (teamId: string) =>
    ipcRenderer.invoke('atlas:getSlackInstallation', teamId),
  atlasStartSlackInstall: (teamId: string) => ipcRenderer.invoke('atlas:startSlackInstall', teamId),
  atlasGetDiscordConnection: (teamId: string) =>
    ipcRenderer.invoke('atlas:getDiscordConnection', teamId),
  atlasDisconnectDiscord: (teamId: string) => ipcRenderer.invoke('atlas:disconnectDiscord', teamId),
  atlasStartDiscordInstall: (teamId: string) =>
    ipcRenderer.invoke('atlas:startDiscordInstall', teamId),
  atlasStartDiscordLink: (teamId: string) => ipcRenderer.invoke('atlas:startDiscordLink', teamId),
  atlasCancelSlackOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelSlackOAuth', teamId),
  atlasDisconnectSlack: (teamId: string) => ipcRenderer.invoke('atlas:disconnectSlack', teamId),
  atlasListSlackChannels: (teamId: string) => ipcRenderer.invoke('atlas:listSlackChannels', teamId),
  atlasGetMySlackUserMapping: (teamId: string) =>
    ipcRenderer.invoke('atlas:getMySlackUserMapping', teamId),
  atlasLinkMySlackUser: (
    teamId: string,
    input: { slackWorkspaceId: string; slackUserId: string },
  ) => ipcRenderer.invoke('atlas:linkMySlackUser', teamId, input),
  atlasUpsertSlackChannelMapping: (
    teamId: string,
    input: { slackWorkspaceId: string; slackChannelId: string; enabled?: boolean },
  ) => ipcRenderer.invoke('atlas:upsertSlackChannelMapping', teamId, input),
  atlasDeleteSlackChannelMapping: (
    teamId: string,
    slackWorkspaceId: string,
    slackChannelId: string,
  ) =>
    ipcRenderer.invoke('atlas:deleteSlackChannelMapping', teamId, slackWorkspaceId, slackChannelId),
  atlasListSlackUserMappings: (teamId: string) =>
    ipcRenderer.invoke('atlas:listSlackUserMappings', teamId),
  atlasUpsertSlackUserMapping: (
    teamId: string,
    input: {
      slackWorkspaceId: string
      slackUserId: string
      nuphosUserId: string
      enabled?: boolean
    },
  ) => ipcRenderer.invoke('atlas:upsertSlackUserMapping', teamId, input),
  atlasDeleteSlackUserMapping: (teamId: string, slackWorkspaceId: string, slackUserId: string) =>
    ipcRenderer.invoke('atlas:deleteSlackUserMapping', teamId, slackWorkspaceId, slackUserId),
  atlasGetLarkInstallation: (teamId: string) =>
    ipcRenderer.invoke('atlas:getLarkInstallation', teamId),
  atlasGetLarkConnectionStatus: (teamId: string) =>
    ipcRenderer.invoke('atlas:getLarkConnectionStatus', teamId),
  atlasBindLark: (teamId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:bindLark', teamId, input),
  atlasDisconnectLark: (teamId: string) => ipcRenderer.invoke('atlas:disconnectLark', teamId),
  atlasListLarkChatMappings: (teamId: string) =>
    ipcRenderer.invoke('atlas:listLarkChatMappings', teamId),
  atlasListLarkAvailableChats: (teamId: string) =>
    ipcRenderer.invoke('atlas:listLarkAvailableChats', teamId),
  atlasUpsertLarkChatMapping: (
    teamId: string,
    input: { chatId: string; enabled?: boolean; name?: string },
  ) => ipcRenderer.invoke('atlas:upsertLarkChatMapping', teamId, input),
  atlasDeleteLarkChatMapping: (teamId: string, chatId: string) =>
    ipcRenderer.invoke('atlas:deleteLarkChatMapping', teamId, chatId),
  atlasListLarkUserMappings: (teamId: string) =>
    ipcRenderer.invoke('atlas:listLarkUserMappings', teamId),
  atlasDeleteLarkUserMapping: (teamId: string, openId: string) =>
    ipcRenderer.invoke('atlas:deleteLarkUserMapping', teamId, openId),
  atlasCreateLarkPairCode: (teamId: string) =>
    ipcRenderer.invoke('atlas:createLarkPairCode', teamId),
  atlasGetApiUrl: () => ipcRenderer.invoke('atlas:getApiUrl'),
  atlasListClusters: (teamId: string) => ipcRenderer.invoke('atlas:listClusters', teamId),
  atlasUseCluster: (teamId: string, provider: string, region: string, name: string) =>
    ipcRenderer.invoke('atlas:useCluster', teamId, provider, region, name),
  atlasListAwsAccounts: (teamId: string) => ipcRenderer.invoke('atlas:listAwsAccounts', teamId),
  atlasListGcpProjects: (teamId: string) => ipcRenderer.invoke('atlas:listGcpProjects', teamId),
  atlasListCloudflareAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareAccounts', teamId),
  atlasListCloudflareZones: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareZones', teamId, accountId),
  atlasListCloudflareDnsRecords: (teamId: string, accountId: string, zoneId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareDnsRecords', teamId, accountId, zoneId),
  atlasCreateCloudflareDnsRecord: (
    teamId: string,
    accountId: string,
    zoneId: string,
    input: unknown,
  ) => ipcRenderer.invoke('atlas:createCloudflareDnsRecord', teamId, accountId, zoneId, input),
  atlasUpdateCloudflareDnsRecord: (
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
    input: unknown,
  ) =>
    ipcRenderer.invoke(
      'atlas:updateCloudflareDnsRecord',
      teamId,
      accountId,
      zoneId,
      recordId,
      input,
    ),
  atlasDeleteCloudflareDnsRecord: (
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
  ) => ipcRenderer.invoke('atlas:deleteCloudflareDnsRecord', teamId, accountId, zoneId, recordId),
  // --- Cloudflare Workers ---
  atlasListCloudflareWorkers: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareWorkers', teamId, accountId),
  atlasListCloudflareWorkerDomains: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareWorkerDomains', teamId, accountId),
  atlasGetCloudflareWorkerSettings: (teamId: string, accountId: string, scriptName: string) =>
    ipcRenderer.invoke('atlas:getCloudflareWorkerSettings', teamId, accountId, scriptName),
  atlasListCloudflareWorkerCronTriggers: (teamId: string, accountId: string, scriptName: string) =>
    ipcRenderer.invoke('atlas:listCloudflareWorkerCronTriggers', teamId, accountId, scriptName),
}
