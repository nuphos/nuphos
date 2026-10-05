import type { LarkBindInput } from '../types/messaging.ts'
import type {
  AgentProvider,
  CreateRuntimeInput,
  ExternalRuntimeProviderProbe,
  PairExternalRuntimeInput,
  RegisterExternalRuntimeInput,
  UpdateRuntimeInput,
} from '../types/runtime'
import type { SidebarFavoriteCloudEntry, TeamRole } from '../types/team.ts'

export const teamApi = {
  atlasReadRuntimeFile: (teamId: string, runtimeId: string, sessionId: string, path: string) =>
    window.api.atlasReadRuntimeFile(teamId, runtimeId, sessionId, path),
  atlasListRuntimeFiles: (teamId: string, runtimeId: string, sessionId: string, path: string) =>
    window.api.atlasListRuntimeFiles(teamId, runtimeId, sessionId, path),
  atlasStartRuntimeLogin: (teamId: string, runtimeId: string) =>
    window.api.atlasStartRuntimeLogin(teamId, runtimeId),
  atlasGetRuntimeLogin: (teamId: string, runtimeId: string) =>
    window.api.atlasGetRuntimeLogin(teamId, runtimeId),
  atlasCancelRuntimeLogin: (teamId: string, runtimeId: string, attemptId: string) =>
    window.api.atlasCancelRuntimeLogin(teamId, runtimeId, attemptId),
  atlasSubmitRuntimeLoginCode: (
    teamId: string,
    runtimeId: string,
    attemptId: string,
    code: string,
  ) => window.api.atlasSubmitRuntimeLoginCode(teamId, runtimeId, attemptId, code),
  atlasListRuntimeInstances: (teamId: string) => window.api.atlasListRuntimeInstances(teamId),
  atlasListRuntimeQuotas: (teamId: string) => window.api.atlasListRuntimeQuotas(teamId),
  atlasCreateRuntimeInstance: (teamId: string, input: CreateRuntimeInput) =>
    window.api.atlasCreateRuntimeInstance(teamId, input),
  atlasProbeExternalRuntimeProvider: (
    teamId: string,
    url: string,
    password: string,
  ): Promise<ExternalRuntimeProviderProbe> =>
    window.api.atlasProbeExternalRuntimeProvider(teamId, url, password),
  atlasRegisterExternalRuntime: (teamId: string, input: RegisterExternalRuntimeInput) =>
    window.api.atlasRegisterExternalRuntime(teamId, input),
  atlasPairExternalRuntime: (teamId: string, input: PairExternalRuntimeInput) =>
    window.api.atlasPairExternalRuntime(teamId, input),
  atlasUpdateRuntimeInstance: (teamId: string, runtimeId: string, input: UpdateRuntimeInput) =>
    window.api.atlasUpdateRuntimeInstance(teamId, runtimeId, input),
  atlasRemoveRuntimeInstance: (teamId: string, runtimeId: string) =>
    window.api.atlasRemoveRuntimeInstance(teamId, runtimeId),
  atlasGetRuntimeModels: (teamId: string, runtimeId: string, model?: string) =>
    window.api.atlasGetRuntimeModels(teamId, runtimeId, model),
  atlasRequestRuntimeUpdate: (teamId: string, runtimeId: string) =>
    window.api.atlasRequestRuntimeUpdate(teamId, runtimeId),
  atlasGetRuntimeInstanceStatus: (teamId: string, runtimeId: string) =>
    window.api.atlasGetRuntimeInstanceStatus(teamId, runtimeId),
  atlasGetRuntimeInstanceMetrics: (teamId: string, runtimeId: string, hours: number) =>
    window.api.atlasGetRuntimeInstanceMetrics(teamId, runtimeId, hours),

  atlasGetSidebarFavorites: (teamId: string) => window.api.atlasGetSidebarFavorites(teamId),
  atlasPutSidebarFavorites: (
    teamId: string,
    entries: SidebarFavoriteCloudEntry[],
    expectedRevision: number,
  ) => window.api.atlasPutSidebarFavorites(teamId, entries, expectedRevision),
  atlasCreateTeam: (name: string) => window.api.atlasCreateTeam(name),
  atlasUpdateTeam: (teamId: string, input: { name?: string; avatarUrl?: string }) =>
    window.api.atlasUpdateTeam(teamId, input),
  atlasSetTeamEmailDomainDiscovery: (teamId: string, enabled: boolean) =>
    window.api.atlasSetTeamEmailDomainDiscovery(teamId, enabled),
  atlasSetTeamAgentRuntime: (teamId: string, runtime: AgentProvider) =>
    window.api.atlasSetTeamAgentRuntime(teamId, runtime),
  atlasListDiscoverableTeams: () => window.api.atlasListDiscoverableTeams(),
  atlasJoinDiscoverableTeam: (teamId: string) => window.api.atlasJoinDiscoverableTeam(teamId),
  atlasListTeamMembers: (teamId: string, includeRemoved?: boolean) =>
    window.api.atlasListTeamMembers(teamId, includeRemoved),
  atlasListTeamInvitations: (teamId: string) => window.api.atlasListTeamInvitations(teamId),
  atlasCancelTeamInvitation: (teamId: string, invitationId: string) =>
    window.api.atlasCancelTeamInvitation(teamId, invitationId),
  atlasRemoveTeamMember: (teamId: string, memberId: string) =>
    window.api.atlasRemoveTeamMember(teamId, memberId),
  atlasDeleteTeam: (teamId: string) => window.api.atlasDeleteTeam(teamId),
  atlasLeaveTeam: (teamId: string) => window.api.atlasLeaveTeam(teamId),
  atlasUpdateTeamMemberRole: (teamId: string, memberId: string, role: TeamRole) =>
    window.api.atlasUpdateTeamMemberRole(teamId, memberId, role),
  atlasListMyInvitations: () => window.api.atlasListMyInvitations(),
  atlasInviteTeamMember: (teamId: string, inviteeEmail: string) =>
    window.api.atlasInviteTeamMember(teamId, inviteeEmail),
  atlasAcceptInvitation: (invitationId: string) => window.api.atlasAcceptInvitation(invitationId),
  atlasRejectInvitation: (invitationId: string) => window.api.atlasRejectInvitation(invitationId),
  atlasListSlackChannelMappings: (teamId: string) =>
    window.api.atlasListSlackChannelMappings(teamId),
  atlasGetSlackConnectionStatus: (teamId: string) =>
    window.api.atlasGetSlackConnectionStatus(teamId),
  atlasGetSlackInstallation: (teamId: string) => window.api.atlasGetSlackInstallation(teamId),
  atlasStartSlackInstall: (teamId: string) => window.api.atlasStartSlackInstall(teamId),
  atlasGetDiscordConnection: (teamId: string) => window.api.atlasGetDiscordConnection(teamId),
  atlasDisconnectDiscord: (teamId: string) => window.api.atlasDisconnectDiscord(teamId),
  atlasStartDiscordInstall: (teamId: string) => window.api.atlasStartDiscordInstall(teamId),
  atlasStartDiscordLink: (teamId: string) => window.api.atlasStartDiscordLink(teamId),
  atlasCancelSlackOAuth: (teamId: string) => window.api.atlasCancelSlackOAuth(teamId),
  atlasDisconnectSlack: (teamId: string) => window.api.atlasDisconnectSlack(teamId),
  atlasListSlackChannels: (teamId: string) => window.api.atlasListSlackChannels(teamId),
  atlasGetMySlackUserMapping: (teamId: string) => window.api.atlasGetMySlackUserMapping(teamId),
  atlasLinkMySlackUser: (
    teamId: string,
    input: { slackWorkspaceId: string; slackUserId: string },
  ) => window.api.atlasLinkMySlackUser(teamId, input),
  atlasUpsertSlackChannelMapping: (
    teamId: string,
    input: { slackWorkspaceId: string; slackChannelId: string; enabled?: boolean },
  ) => window.api.atlasUpsertSlackChannelMapping(teamId, input),
  atlasDeleteSlackChannelMapping: (
    teamId: string,
    slackWorkspaceId: string,
    slackChannelId: string,
  ) => window.api.atlasDeleteSlackChannelMapping(teamId, slackWorkspaceId, slackChannelId),
  atlasListSlackUserMappings: (teamId: string) => window.api.atlasListSlackUserMappings(teamId),
  atlasUpsertSlackUserMapping: (
    teamId: string,
    input: {
      slackWorkspaceId: string
      slackUserId: string
      nuphosUserId: string
      enabled?: boolean
    },
  ) => window.api.atlasUpsertSlackUserMapping(teamId, input),
  atlasDeleteSlackUserMapping: (teamId: string, slackWorkspaceId: string, slackUserId: string) =>
    window.api.atlasDeleteSlackUserMapping(teamId, slackWorkspaceId, slackUserId),
  atlasGetLarkInstallation: (teamId: string) => window.api.atlasGetLarkInstallation(teamId),
  atlasGetLarkConnectionStatus: (teamId: string) => window.api.atlasGetLarkConnectionStatus(teamId),
  atlasBindLark: (teamId: string, input: LarkBindInput) => window.api.atlasBindLark(teamId, input),
  atlasDisconnectLark: (teamId: string) => window.api.atlasDisconnectLark(teamId),
  atlasListLarkChatMappings: (teamId: string) => window.api.atlasListLarkChatMappings(teamId),
  atlasListLarkAvailableChats: (teamId: string) => window.api.atlasListLarkAvailableChats(teamId),
  atlasUpsertLarkChatMapping: (
    teamId: string,
    input: { chatId: string; enabled?: boolean; name?: string },
  ) => window.api.atlasUpsertLarkChatMapping(teamId, input),
  atlasDeleteLarkChatMapping: (teamId: string, chatId: string) =>
    window.api.atlasDeleteLarkChatMapping(teamId, chatId),
  atlasListLarkUserMappings: (teamId: string) => window.api.atlasListLarkUserMappings(teamId),
  atlasDeleteLarkUserMapping: (teamId: string, openId: string) =>
    window.api.atlasDeleteLarkUserMapping(teamId, openId),
  atlasCreateLarkPairCode: (teamId: string) => window.api.atlasCreateLarkPairCode(teamId),
  atlasGetApiUrl: () => window.api.atlasGetApiUrl(),
  atlasListClusters: (teamId: string) => window.api.atlasListClusters(teamId),
  atlasUseCluster: (teamId: string, provider: string, region: string, name: string) =>
    window.api.atlasUseCluster(teamId, provider, region, name),
  atlasListAwsAccounts: (teamId: string) => window.api.atlasListAwsAccounts(teamId),
  atlasListGcpProjects: (teamId: string) => window.api.atlasListGcpProjects(teamId),
}
