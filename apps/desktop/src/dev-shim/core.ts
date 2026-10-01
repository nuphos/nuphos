import { call, empty, noop } from './http.ts'

import type { CreateRuntimeInput, UpdateRuntimeInput } from '../types/runtime'
/* eslint-disable @typescript-eslint/no-explicit-any */

export function coreMethods(): Record<string, any> {
  return {
    atlasStartRuntimeLogin: (teamId: string, runtimeId: string) =>
      call('POST', `/teams/${teamId}/agent-runtimes/${runtimeId}/login`),
    atlasGetRuntimeLogin: (teamId: string, runtimeId: string) =>
      call('GET', `/teams/${teamId}/agent-runtimes/${runtimeId}/login`),
    atlasCancelRuntimeLogin: (teamId: string, runtimeId: string, attemptId: string) =>
      call('DELETE', `/teams/${teamId}/agent-runtimes/${runtimeId}/login`, { attemptId }),
    atlasSubmitRuntimeLoginCode: (
      teamId: string,
      runtimeId: string,
      attemptId: string,
      code: string,
    ) =>
      call('POST', `/teams/${teamId}/agent-runtimes/${runtimeId}/login/code`, { attemptId, code }),
    atlasListRuntimeInstances: (teamId: string) =>
      call('GET', `/teams/${teamId}/agent-runtimes`).then((data: any) => data.runtimes ?? []),
    atlasListRuntimeQuotas: (teamId: string) =>
      call('GET', `/teams/${teamId}/agent-runtimes/quota`).then((data: any) => data.quotas ?? []),
    atlasCreateRuntimeInstance: (teamId: string, input: CreateRuntimeInput) =>
      call('POST', `/teams/${teamId}/agent-runtimes`, input),
    atlasUpdateRuntimeInstance: (teamId: string, runtimeId: string, input: UpdateRuntimeInput) =>
      call('PATCH', `/teams/${teamId}/agent-runtimes/${runtimeId}`, input),
    atlasRemoveRuntimeInstance: (teamId: string, runtimeId: string) =>
      call('DELETE', `/teams/${teamId}/agent-runtimes/${runtimeId}`),
    atlasGetRuntimeModels: (teamId: string, runtimeId: string, model?: string) =>
      call(
        'GET',
        `/teams/${teamId}/agent-runtimes/${runtimeId}/models${model ? '?model=' + encodeURIComponent(model) : ''}`,
      ),
    atlasGetRuntimeInstanceStatus: (teamId: string, runtimeId: string) =>
      call('GET', `/teams/${teamId}/agent-runtimes/${runtimeId}/status`),
    atlasGetRuntimeInstanceMetrics: (teamId: string, runtimeId: string, hours: number) =>
      call('GET', `/teams/${teamId}/agent-runtimes/${runtimeId}/metrics?hours=${String(hours)}`),
    // Auth — claim signed-in so the app boots past LoginView.
    authUpdateProfile: (input: { name: string; username: string; avatarURL: string }) =>
      call('PATCH', '/auth/me', input),
    authStatus: () =>
      empty({
        loggedIn: true,
        user: { name: 'Dev', username: 'dev', email: 'dev@local', avatarURL: '' },
      }),
    authLogin: noop,
    authLogout: noop,
    authCancel: noop,
    authEmailRequestCode: noop,
    authEmailVerifyCode: () =>
      empty({ name: 'Dev', username: 'dev', email: 'dev@local', avatarURL: '' }),
    appGetVersion: () => empty('dev'),
    appGetPlatform: () => empty('darwin'),
    appSetNativeTheme: noop,
    getZoomFactor: () => 1,
    notifyZoom: () => {},
    appHideWindow: noop,
    updaterGetState: () => empty({ kind: 'idle' }),
    updaterCheck: noop,
    updaterInstall: noop,
    onUpdaterStatus: () => () => {},

    // Nuphos — proxied to localhost:3717 via Vite.
    atlasListTeams: () => call('GET', '/teams').then((d: any) => d.teams ?? []),
    atlasSetTeamEmailDomainDiscovery: (teamId: string, enabled: boolean) =>
      call('PUT', `/teams/${teamId}/allowed-email-domains`, { enabled }),
    atlasSetTeamAgentRuntime: (teamId: string, runtime: string) =>
      call('PUT', `/teams/${teamId}/agent-runtime`, { runtime }),
    atlasListDiscoverableTeams: () =>
      call('GET', '/teams/discoverable').then((d: any) => d.teams ?? []),
    atlasJoinDiscoverableTeam: (teamId: string) =>
      call('POST', `/teams/discoverable/${teamId}/join`).then((d: any) => d.team),
    atlasCreateTeam: (name: string) => call('POST', '/teams', { name }).then((d: any) => d.team),
    atlasListTeamMembers: (teamId: string, includeRemoved?: boolean) =>
      call(
        'GET',
        includeRemoved
          ? `/teams/${teamId}/members?includeRemoved=true`
          : `/teams/${teamId}/members`,
      ).then((d: any) => d.members ?? []),
    atlasListTeamInvitations: (teamId: string) =>
      call('GET', `/teams/${teamId}/invitations`).then((d: any) => d.invitations ?? []),
    atlasCancelTeamInvitation: (teamId: string, invitationId: string) =>
      call('DELETE', `/teams/${teamId}/invitations/${invitationId}`).then((d: any) => d.invitation),
    atlasRemoveTeamMember: (teamId: string, memberId: string) =>
      call('DELETE', `/teams/${teamId}/members/${memberId}`),
    atlasListMyInvitations: () => call('GET', '/invitations').then((d: any) => d.invitations ?? []),
    atlasInviteTeamMember: (teamId: string, inviteeEmail: string) =>
      call('POST', `/teams/${teamId}/invitations`, { inviteeEmail }).then((d: any) => d.invitation),
    atlasAcceptInvitation: (invitationId: string) =>
      call('POST', `/invitations/${invitationId}/accept`).then((d: any) => d.invitation),
    atlasRejectInvitation: (invitationId: string) =>
      call('POST', `/invitations/${invitationId}/reject`).then((d: any) => d.invitation),
    atlasListSlackChannelMappings: (teamId: string) =>
      call('GET', `/slack/mappings?teamId=${encodeURIComponent(teamId)}`).then(
        (d: any) => d.mappings ?? [],
      ),
    atlasGetSlackConnectionStatus: (teamId: string) =>
      call('GET', `/teams/${teamId}/slack-installations/status`),
    atlasGetSlackInstallation: (teamId: string) =>
      call('GET', `/teams/${teamId}/slack-installations`),
    atlasStartSlackInstall: (teamId: string) =>
      call('POST', `/teams/${teamId}/slack-installations/start-oauth`, {}).then(() => {}),
    atlasGetDiscordConnection: (teamId: string) =>
      call('GET', `/teams/${teamId}/discord-installations`),
    atlasStartDiscordInstall: (teamId: string) =>
      call('POST', `/teams/${teamId}/discord-installations/start-oauth`, {}).then(() => {}),
    atlasStartDiscordLink: (teamId: string) =>
      call('POST', `/teams/${teamId}/discord-installations/start-link`, {}).then(() => {}),
    atlasCancelSlackOAuth: (_teamId: string) => Promise.resolve(),
    atlasDisconnectSlack: (teamId: string) =>
      call('DELETE', `/teams/${teamId}/slack-installations`),
    atlasListSlackChannels: (teamId: string) =>
      call('GET', `/teams/${teamId}/slack-installations/channels`),
    atlasGetMySlackUserMapping: (teamId: string) =>
      call('GET', `/slack/user-mappings/me?teamId=${encodeURIComponent(teamId)}`).then(
        (d: any) => d.mapping ?? null,
      ),
    atlasLinkMySlackUser: (
      teamId: string,
      input: { slackWorkspaceId: string; slackUserId: string },
    ) => call('PUT', '/slack/user-mappings/self', { teamId, ...input }).then((d: any) => d.mapping),
    atlasUpsertSlackChannelMapping: (
      teamId: string,
      input: { slackWorkspaceId: string; slackChannelId: string; enabled?: boolean },
    ) => call('PUT', '/slack/mappings', { teamId, ...input }).then((d: any) => d.mapping),
    atlasDeleteSlackChannelMapping: (
      teamId: string,
      slackWorkspaceId: string,
      slackChannelId: string,
    ) =>
      call(
        'DELETE',
        `/slack/mappings/${slackWorkspaceId}/${slackChannelId}?teamId=${encodeURIComponent(teamId)}`,
      ),
    atlasListSlackUserMappings: (teamId: string) =>
      call('GET', `/slack/user-mappings?teamId=${encodeURIComponent(teamId)}`).then(
        (d: any) => d.mappings ?? [],
      ),
    atlasUpsertSlackUserMapping: (
      teamId: string,
      input: {
        slackWorkspaceId: string
        slackUserId: string
        nuphosUserId: string
        enabled?: boolean
      },
    ) => call('PUT', '/slack/user-mappings', { teamId, ...input }).then((d: any) => d.mapping),
    atlasDeleteSlackUserMapping: (teamId: string, slackWorkspaceId: string, slackUserId: string) =>
      call(
        'DELETE',
        `/slack/user-mappings/${slackWorkspaceId}/${slackUserId}?teamId=${encodeURIComponent(teamId)}`,
      ),
    atlasGetLarkInstallation: (teamId: string) =>
      call('GET', `/teams/${teamId}/lark-installations`),
    atlasGetLarkConnectionStatus: (teamId: string) =>
      call('GET', `/teams/${teamId}/lark-installations/status`),
    atlasBindLark: (teamId: string, input: unknown) =>
      call('PUT', `/teams/${teamId}/lark-installations`, input),
    atlasDisconnectLark: (teamId: string) => call('DELETE', `/teams/${teamId}/lark-installations`),
    atlasListLarkChatMappings: (teamId: string) =>
      call('GET', `/lark/mappings?teamId=${encodeURIComponent(teamId)}`).then(
        (d: any) => d.mappings ?? [],
      ),
    atlasListLarkAvailableChats: (teamId: string) =>
      call('GET', `/lark/available-chats?teamId=${encodeURIComponent(teamId)}`).then(
        (d: any) => d.chats ?? [],
      ),
    atlasUpsertLarkChatMapping: (
      teamId: string,
      input: { chatId: string; enabled?: boolean; name?: string },
    ) => call('PUT', '/lark/mappings', { teamId, ...input }).then((d: any) => d.mapping),
    atlasDeleteLarkChatMapping: (teamId: string, chatId: string) =>
      call(
        'DELETE',
        `/lark/mappings/${encodeURIComponent(chatId)}?teamId=${encodeURIComponent(teamId)}`,
      ),
    atlasListLarkUserMappings: (teamId: string) =>
      call('GET', `/lark/user-mappings?teamId=${encodeURIComponent(teamId)}`).then(
        (d: any) => d.mappings ?? [],
      ),
    atlasDeleteLarkUserMapping: (teamId: string, openId: string) =>
      call(
        'DELETE',
        `/lark/user-mappings/${encodeURIComponent(openId)}?teamId=${encodeURIComponent(teamId)}`,
      ),
    // The browser shim talks to the backend through the Vite proxy, so the
    // proxy path is the closest thing to a backend base URL here.
    atlasGetApiUrl: () => Promise.resolve(`${window.location.origin}/atlas-api`),
  }
}
