import * as atlas from '../atlas'
import * as discordInstall from '../discord-install'
import * as slackInstall from '../slack-install'

import { importLocalSkill } from './local-skill-import'
import { listLocalSkills } from './local-skills'

import type { DashboardViewRange } from '../../src/dashboards/schema'
import type {
  CreateRuntimeInput,
  PairExternalRuntimeInput,
  RegisterExternalRuntimeInput,
  UpdateRuntimeInput,
} from '../../src/types/runtime'

export const teamChannels = {
  'atlas:startRuntimeLogin': (_e: unknown, teamId: string, runtimeId: string) =>
    atlas.startRuntimeLogin(teamId, runtimeId),
  'atlas:getRuntimeLogin': (_e: unknown, teamId: string, runtimeId: string) =>
    atlas.getRuntimeLogin(teamId, runtimeId),
  'atlas:cancelRuntimeLogin': (_e: unknown, teamId: string, runtimeId: string, attemptId: string) =>
    atlas.cancelRuntimeLogin(teamId, runtimeId, attemptId),
  'atlas:submitRuntimeLoginCode': (
    _e: unknown,
    teamId: string,
    runtimeId: string,
    attemptId: string,
    code: string,
  ) => atlas.submitRuntimeLoginCode(teamId, runtimeId, attemptId, code),
  'atlas:listRuntimeInstances': (_e: unknown, teamId: string) => atlas.listRuntimeInstances(teamId),
  'atlas:listRuntimeQuotas': (_e: unknown, teamId: string) => atlas.listRuntimeQuotas(teamId),
  'atlas:createRuntimeInstance': (_e: unknown, teamId: string, input: CreateRuntimeInput) =>
    atlas.createRuntimeInstance(teamId, input),
  'atlas:probeExternalRuntimeProvider': (
    _e: unknown,
    teamId: string,
    url: string,
    password: string,
  ) => atlas.probeExternalRuntimeProvider(teamId, url, password),
  'atlas:registerExternalRuntime': (
    _e: unknown,
    teamId: string,
    input: RegisterExternalRuntimeInput,
  ) => atlas.registerExternalRuntime(teamId, input),
  'atlas:pairExternalRuntime': (_e: unknown, teamId: string, input: PairExternalRuntimeInput) =>
    atlas.pairExternalRuntime(teamId, input),
  'atlas:updateRuntimeInstance': (
    _e: unknown,
    teamId: string,
    runtimeId: string,
    input: UpdateRuntimeInput,
  ) => atlas.updateRuntimeInstance(teamId, runtimeId, input),
  'atlas:removeRuntimeInstance': (_e: unknown, teamId: string, runtimeId: string) =>
    atlas.removeRuntimeInstance(teamId, runtimeId),
  'atlas:getRuntimeModels': (_e: unknown, teamId: string, runtimeId: string, model?: string) =>
    atlas.getRuntimeModels(teamId, runtimeId, model),
  'atlas:requestRuntimeUpdate': (_e: unknown, teamId: string, runtimeId: string) =>
    atlas.requestRuntimeUpdate(teamId, runtimeId),
  'atlas:getRuntimeInstanceStatus': (_e: unknown, teamId: string, runtimeId: string) =>
    atlas.getRuntimeInstanceStatus(teamId, runtimeId),
  'atlas:getRuntimeInstanceMetrics': (
    _e: unknown,
    teamId: string,
    runtimeId: string,
    hours: number,
  ) => atlas.getRuntimeInstanceMetrics(teamId, runtimeId, hours),

  'atlas:listTeams': () => atlas.listTeams(),
  'atlas:getSidebarFavorites': (_e: unknown, teamId: string) => atlas.getSidebarFavorites(teamId),
  'atlas:putSidebarFavorites': (
    _e: unknown,
    teamId: string,
    entries: atlas.SidebarFavoriteEntry[],
    expectedRevision: number,
  ) => atlas.putSidebarFavorites(teamId, entries, expectedRevision),
  'arch:listDiagrams': (_e: unknown, teamId: string) => atlas.archListDiagrams(teamId),
  'arch:getDiagram': (_e: unknown, teamId: string, diagramId: string) =>
    atlas.archGetDiagram(teamId, diagramId),
  'arch:createDiagram': (_e: unknown, teamId: string, name: string) =>
    atlas.archCreateDiagram(teamId, name),
  'arch:saveDiagram': (_e: unknown, teamId: string, diagramId: string, patch: unknown) =>
    atlas.archSaveDiagram(teamId, diagramId, patch),
  'arch:deleteDiagram': (_e: unknown, teamId: string, diagramId: string) =>
    atlas.archDeleteDiagram(teamId, diagramId),
  // --- Dashboards ---
  'dashboards:list': (_e: unknown, teamId: string) => atlas.dashboardsList(teamId),
  'dashboards:create': (_e: unknown, teamId: string, input: unknown) =>
    atlas.dashboardsCreate(teamId, input),
  'dashboards:get': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsGet(teamId, dashboardId, viewRange),
  'dashboards:update': (_e: unknown, teamId: string, dashboardId: string, input: unknown) =>
    atlas.dashboardsUpdate(teamId, dashboardId, input),
  'dashboards:delete': (_e: unknown, teamId: string, dashboardId: string) =>
    atlas.dashboardsDelete(teamId, dashboardId),
  'dashboards:refresh': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsRefresh(teamId, dashboardId, force, viewRange),
  'dashboards:createPanel': (_e: unknown, teamId: string, dashboardId: string, input: unknown) =>
    atlas.dashboardsCreatePanel(teamId, dashboardId, input),
  'dashboards:updatePanel': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: unknown,
  ) => atlas.dashboardsUpdatePanel(teamId, dashboardId, panelId, input),
  'dashboards:deletePanel': (_e: unknown, teamId: string, dashboardId: string, panelId: string) =>
    atlas.dashboardsDeletePanel(teamId, dashboardId, panelId),
  'dashboards:executePanel': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsExecutePanel(teamId, dashboardId, panelId, force, viewRange),
  'dashboards:generateInsight': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsGenerateInsight(teamId, dashboardId, panelId, viewRange),
  'dashboards:insightFeedback': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    rating: 'up' | 'down',
    note?: string,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsInsightFeedback(teamId, dashboardId, panelId, rating, note, viewRange),
  'dashboards:getAlert': (_e: unknown, teamId: string, dashboardId: string, panelId: string) =>
    atlas.dashboardsGetAlert(teamId, dashboardId, panelId),
  'dashboards:saveAlert': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: unknown,
  ) => atlas.dashboardsSaveAlert(teamId, dashboardId, panelId, input),
  'dashboards:deleteAlert': (_e: unknown, teamId: string, dashboardId: string, panelId: string) =>
    atlas.dashboardsDeleteAlert(teamId, dashboardId, panelId),
  'teamSkills:getManifest': (_e: unknown, teamId: string) => atlas.teamSkillsGetManifest(teamId),
  'teamSkills:listObjects': (_e: unknown, teamId: string) => atlas.teamSkillsListObjects(teamId),
  'teamSkills:getObject': (_e: unknown, teamId: string, key: string) =>
    atlas.teamSkillsGetObject(teamId, key),
  'teamSkills:getHistory': (_e: unknown, teamId: string, name: string) =>
    atlas.teamSkillsGetHistory(teamId, name),
  'teamSkills:putObject': (
    _e: unknown,
    teamId: string,
    key: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
  ) => atlas.teamSkillsPutObject(teamId, key, file),
  'teamSkills:listLocal': () => listLocalSkills(),
  'teamSkills:importLocal': (_e: unknown, teamId: string, skillId: string) =>
    importLocalSkill(teamId, skillId),
  'teamSkills:deleteObject': (_e: unknown, teamId: string, key: string) =>
    atlas.teamSkillsDeleteObject(teamId, key),
  'teamSkills:deleteSkill': (_e: unknown, teamId: string, name: string) =>
    atlas.teamSkillsDeleteSkill(teamId, name),
  'atlas:createTeam': (_e: unknown, name: string) => atlas.createTeam(name),
  'atlas:updateTeam': (_e: unknown, teamId: string, input: { name?: string; avatarUrl?: string }) =>
    atlas.updateTeam(teamId, input),
  'atlas:setTeamEmailDomainDiscovery': (_e: unknown, teamId: string, enabled: boolean) =>
    atlas.setTeamEmailDomainDiscovery(teamId, enabled),
  'atlas:setTeamAgentRuntime': (_e: unknown, teamId: string, runtime: 'claude-code' | 'codex') =>
    atlas.setTeamAgentRuntime(teamId, runtime),
  'atlas:listDiscoverableTeams': () => atlas.listDiscoverableTeams(),
  'atlas:joinDiscoverableTeam': (_e: unknown, teamId: string) => atlas.joinDiscoverableTeam(teamId),
  'atlas:listTeamMembers': (_e: unknown, teamId: string, includeRemoved?: boolean) =>
    atlas.listTeamMembers(teamId, includeRemoved),
  'atlas:listTeamInvitations': (_e: unknown, teamId: string) => atlas.listTeamInvitations(teamId),
  'atlas:cancelTeamInvitation': (_e: unknown, teamId: string, invitationId: string) =>
    atlas.cancelTeamInvitation(teamId, invitationId),
  'atlas:removeTeamMember': (_e: unknown, teamId: string, memberId: string) =>
    atlas.removeTeamMember(teamId, memberId),
  'atlas:deleteTeam': (_e: unknown, teamId: string) => atlas.deleteTeam(teamId),
  'atlas:leaveTeam': (_e: unknown, teamId: string) => atlas.leaveTeam(teamId),
  'atlas:updateTeamMemberRole': (
    _e: unknown,
    teamId: string,
    memberId: string,
    role: atlas.TeamRole,
  ) => atlas.updateTeamMemberRole(teamId, memberId, role),
  'atlas:listMyInvitations': () => atlas.listMyInvitations(),
  'atlas:inviteTeamMember': (_e: unknown, teamId: string, inviteeEmail: string) =>
    atlas.inviteTeamMember(teamId, inviteeEmail),
  'atlas:acceptInvitation': (_e: unknown, invitationId: string) =>
    atlas.acceptInvitation(invitationId),
  'atlas:rejectInvitation': (_e: unknown, invitationId: string) =>
    atlas.rejectInvitation(invitationId),
  'atlas:listSlackChannelMappings': (_e: unknown, teamId: string) =>
    atlas.listSlackChannelMappings(teamId),
  'atlas:getSlackConnectionStatus': (_e: unknown, teamId: string) =>
    atlas.getSlackConnectionStatus(teamId),
  'atlas:getSlackInstallation': (_e: unknown, teamId: string) => atlas.getSlackInstallation(teamId),
  'atlas:startSlackInstall': (_e: unknown, teamId: string) => slackInstall.startInstall(teamId),
  'atlas:getDiscordConnection': (_e: unknown, teamId: string) => atlas.getDiscordConnection(teamId),
  'atlas:disconnectDiscord': (_e: unknown, teamId: string) => atlas.disconnectDiscord(teamId),
  'atlas:startDiscordInstall': (_e: unknown, teamId: string) =>
    discordInstall.startOAuth(teamId, 'install'),
  'atlas:startDiscordLink': (_e: unknown, teamId: string) =>
    discordInstall.startOAuth(teamId, 'link'),
  'atlas:cancelSlackOAuth': (_e: unknown, teamId: string) => slackInstall.cancelPending(teamId),
  'atlas:disconnectSlack': (_e: unknown, teamId: string) => atlas.disconnectSlack(teamId),
  'atlas:listSlackChannels': (_e: unknown, teamId: string) => atlas.listSlackChannels(teamId),
  'atlas:getMySlackUserMapping': (_e: unknown, teamId: string) =>
    atlas.getMySlackUserMapping(teamId),
  'atlas:linkMySlackUser': (
    _e: unknown,
    teamId: string,
    input: { slackWorkspaceId: string; slackUserId: string },
  ) => atlas.linkMySlackUser(teamId, input),
  'atlas:upsertSlackChannelMapping': (
    _e: unknown,
    teamId: string,
    input: { slackWorkspaceId: string; slackChannelId: string; enabled?: boolean },
  ) => atlas.upsertSlackChannelMapping(teamId, input),
  'atlas:deleteSlackChannelMapping': (
    _e: unknown,
    teamId: string,
    slackWorkspaceId: string,
    slackChannelId: string,
  ) => atlas.deleteSlackChannelMapping(teamId, slackWorkspaceId, slackChannelId),
  'atlas:listSlackUserMappings': (_e: unknown, teamId: string) =>
    atlas.listSlackUserMappings(teamId),
  'atlas:upsertSlackUserMapping': (
    _e: unknown,
    teamId: string,
    input: {
      slackWorkspaceId: string
      slackUserId: string
      nuphosUserId: string
      enabled?: boolean
    },
  ) => atlas.upsertSlackUserMapping(teamId, input),
  'atlas:deleteSlackUserMapping': (
    _e: unknown,
    teamId: string,
    slackWorkspaceId: string,
    slackUserId: string,
  ) => atlas.deleteSlackUserMapping(teamId, slackWorkspaceId, slackUserId),
  'atlas:getLarkInstallation': (_e: unknown, teamId: string) => atlas.getLarkInstallation(teamId),
  'atlas:getLarkConnectionStatus': (_e: unknown, teamId: string) =>
    atlas.getLarkConnectionStatus(teamId),
  'atlas:bindLark': (_e: unknown, teamId: string, input: atlas.LarkBindInput) =>
    atlas.bindLark(teamId, input),
  'atlas:disconnectLark': (_e: unknown, teamId: string) => atlas.disconnectLark(teamId),
  'atlas:listLarkChatMappings': (_e: unknown, teamId: string) => atlas.listLarkChatMappings(teamId),
  'atlas:listLarkAvailableChats': (_e: unknown, teamId: string) =>
    atlas.listLarkAvailableChats(teamId),
  'atlas:upsertLarkChatMapping': (
    _e: unknown,
    teamId: string,
    input: { chatId: string; enabled?: boolean; name?: string },
  ) => atlas.upsertLarkChatMapping(teamId, input),
  'atlas:deleteLarkChatMapping': (_e: unknown, teamId: string, chatId: string) =>
    atlas.deleteLarkChatMapping(teamId, chatId),
  'atlas:listLarkUserMappings': (_e: unknown, teamId: string) => atlas.listLarkUserMappings(teamId),
  'atlas:deleteLarkUserMapping': (_e: unknown, teamId: string, openId: string) =>
    atlas.deleteLarkUserMapping(teamId, openId),
  'atlas:createLarkPairCode': (_e: unknown, teamId: string) => atlas.createLarkPairCode(teamId),
} as const
