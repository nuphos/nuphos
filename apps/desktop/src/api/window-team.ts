import type {
  LarkAvailableChat,
  LarkBindInput,
  LarkChatMapping,
  LarkConnectionStatus,
  LarkInstallation,
  LarkPairCode,
  LarkUserMapping,
  SlackChannelMapping,
  SlackChannelOption,
  SlackConnectionStatus,
  SlackInstallation,
  SlackUserMapping,
  DiscordConnection,
} from '../types/messaging.ts'
import type { AtlasClustersResponse, AwsAccount, GcpProject } from '../types/provider-accounts.ts'
import type {
  RuntimeInstance,
  RuntimeModelCatalog,
  RuntimeLoginStatus,
  RuntimeMetrics,
  RuntimeQuota,
  CreateRuntimeInput,
  ExternalRuntimeProviderProbe,
  PairExternalRuntimeInput,
  PairedExternalRuntime,
  RegisterExternalRuntimeInput,
  UpdateRuntimeInput,
} from '../types/runtime'
import type {
  AtlasTeam,
  OpenAbRuntimeStatus,
  DiscoverableTeam,
  TeamInvitation,
  TeamMember,
  TeamRole,
  SidebarFavoriteCloudEntry,
  SidebarFavoritesCloudSnapshot,
} from '../types/team.ts'

export type WindowTeamApi = {
  atlasStartRuntimeLogin(teamId: string, runtimeId: string): Promise<RuntimeLoginStatus>
  atlasGetRuntimeLogin(teamId: string, runtimeId: string): Promise<RuntimeLoginStatus>
  atlasCancelRuntimeLogin(teamId: string, runtimeId: string, attemptId: string): Promise<void>
  atlasSubmitRuntimeLoginCode(
    teamId: string,
    runtimeId: string,
    attemptId: string,
    code: string,
  ): Promise<RuntimeLoginStatus>
  atlasListRuntimeInstances(teamId: string): Promise<RuntimeInstance[]>
  atlasListRuntimeQuotas(teamId: string): Promise<RuntimeQuota[]>
  atlasCreateRuntimeInstance(teamId: string, input: CreateRuntimeInput): Promise<RuntimeInstance>
  atlasProbeExternalRuntimeProvider(
    teamId: string,
    url: string,
    password: string,
  ): Promise<ExternalRuntimeProviderProbe>
  atlasRegisterExternalRuntime(
    teamId: string,
    input: RegisterExternalRuntimeInput,
  ): Promise<{ id: string }>
  atlasPairExternalRuntime(
    teamId: string,
    input: PairExternalRuntimeInput,
  ): Promise<PairedExternalRuntime>
  atlasUpdateRuntimeInstance(
    teamId: string,
    runtimeId: string,
    input: UpdateRuntimeInput,
  ): Promise<RuntimeInstance>
  atlasRemoveRuntimeInstance(teamId: string, runtimeId: string): Promise<void>
  atlasGetRuntimeModels(
    teamId: string,
    runtimeId: string,
    model?: string,
  ): Promise<RuntimeModelCatalog>
  atlasRequestRuntimeUpdate(teamId: string, runtimeId: string): Promise<{ version: string }>
  atlasGetRuntimeInstanceStatus(teamId: string, runtimeId: string): Promise<OpenAbRuntimeStatus>
  atlasGetRuntimeInstanceMetrics(
    teamId: string,
    runtimeId: string,
    hours: number,
  ): Promise<RuntimeMetrics>

  atlasGetSidebarFavorites(teamId: string): Promise<SidebarFavoritesCloudSnapshot>
  atlasPutSidebarFavorites(
    teamId: string,
    entries: SidebarFavoriteCloudEntry[],
    expectedRevision: number,
  ): Promise<SidebarFavoritesCloudSnapshot>
  atlasCreateTeam(name: string): Promise<AtlasTeam>
  atlasUpdateTeam(teamId: string, input: { name?: string; avatarUrl?: string }): Promise<AtlasTeam>
  atlasSetTeamEmailDomainDiscovery(teamId: string, enabled: boolean): Promise<AtlasTeam>
  atlasSetTeamAgentRuntime(teamId: string, runtime: 'claude-code' | 'codex'): Promise<AtlasTeam>
  atlasListDiscoverableTeams(): Promise<DiscoverableTeam[]>
  atlasJoinDiscoverableTeam(teamId: string): Promise<AtlasTeam>
  atlasListTeamMembers(teamId: string, includeRemoved?: boolean): Promise<TeamMember[]>
  atlasListTeamInvitations(teamId: string): Promise<TeamInvitation[]>
  atlasCancelTeamInvitation(teamId: string, invitationId: string): Promise<TeamInvitation>
  atlasRemoveTeamMember(teamId: string, memberId: string): Promise<void>
  atlasDeleteTeam(teamId: string): Promise<void>
  atlasLeaveTeam(teamId: string): Promise<void>
  atlasUpdateTeamMemberRole(teamId: string, memberId: string, role: TeamRole): Promise<TeamMember>
  atlasListMyInvitations(): Promise<TeamInvitation[]>
  atlasInviteTeamMember(teamId: string, inviteeEmail: string): Promise<TeamInvitation>
  atlasAcceptInvitation(invitationId: string): Promise<TeamInvitation>
  atlasRejectInvitation(invitationId: string): Promise<TeamInvitation>
  atlasListSlackChannelMappings(teamId: string): Promise<SlackChannelMapping[]>
  atlasGetSlackConnectionStatus(teamId: string): Promise<SlackConnectionStatus>
  atlasGetSlackInstallation(
    teamId: string,
  ): Promise<{ installation: SlackInstallation | null; oauthAvailable: boolean }>
  atlasStartSlackInstall(teamId: string): Promise<void>
  atlasGetDiscordConnection(teamId: string): Promise<DiscordConnection>
  atlasDisconnectDiscord(teamId: string): Promise<void>
  atlasStartDiscordInstall(teamId: string): Promise<void>
  atlasStartDiscordLink(teamId: string): Promise<void>
  atlasCancelSlackOAuth(teamId: string): Promise<void>
  atlasDisconnectSlack(teamId: string): Promise<void>
  atlasListSlackChannels(
    teamId: string,
  ): Promise<{ slackWorkspaceId: string | null; channels: SlackChannelOption[] }>
  atlasGetMySlackUserMapping(teamId: string): Promise<SlackUserMapping | null>
  atlasLinkMySlackUser(
    teamId: string,
    input: { slackWorkspaceId: string; slackUserId: string },
  ): Promise<SlackUserMapping>
  atlasUpsertSlackChannelMapping(
    teamId: string,
    input: { slackWorkspaceId: string; slackChannelId: string; enabled?: boolean },
  ): Promise<SlackChannelMapping>
  atlasDeleteSlackChannelMapping(
    teamId: string,
    slackWorkspaceId: string,
    slackChannelId: string,
  ): Promise<void>
  atlasListSlackUserMappings(teamId: string): Promise<SlackUserMapping[]>
  atlasUpsertSlackUserMapping(
    teamId: string,
    input: {
      slackWorkspaceId: string
      slackUserId: string
      nuphosUserId: string
      enabled?: boolean
    },
  ): Promise<SlackUserMapping>
  atlasDeleteSlackUserMapping(
    teamId: string,
    slackWorkspaceId: string,
    slackUserId: string,
  ): Promise<void>
  atlasGetLarkInstallation(
    teamId: string,
  ): Promise<{ installation: LarkInstallation | null; webhookUrl: string | null }>
  atlasGetLarkConnectionStatus(teamId: string): Promise<LarkConnectionStatus>
  atlasBindLark(
    teamId: string,
    input: LarkBindInput,
  ): Promise<{ installation: LarkInstallation; webhookUrl: string }>
  atlasDisconnectLark(teamId: string): Promise<void>
  atlasListLarkChatMappings(teamId: string): Promise<LarkChatMapping[]>
  atlasListLarkAvailableChats(teamId: string): Promise<LarkAvailableChat[]>
  atlasUpsertLarkChatMapping(
    teamId: string,
    input: { chatId: string; enabled?: boolean; name?: string },
  ): Promise<LarkChatMapping>
  atlasDeleteLarkChatMapping(teamId: string, chatId: string): Promise<void>
  atlasListLarkUserMappings(teamId: string): Promise<LarkUserMapping[]>
  atlasDeleteLarkUserMapping(teamId: string, openId: string): Promise<void>
  atlasCreateLarkPairCode(teamId: string): Promise<LarkPairCode>
  atlasGetApiUrl(): Promise<string>
  atlasListClusters(teamId: string): Promise<AtlasClustersResponse>
  atlasUseCluster(
    teamId: string,
    provider: string,
    region: string,
    name: string,
  ): Promise<{ context: string; expiresAt: string | null }>
  atlasListAwsAccounts(teamId: string): Promise<AwsAccount[]>
  atlasListGcpProjects(teamId: string): Promise<GcpProject[]>
}
