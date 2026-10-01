import * as atlas from '../atlas'
import * as posthogInstall from '../posthog-install'

export const posthogChannels = {
  'atlas:listPosthogIntegrations': (_e: unknown, teamId: string) =>
    atlas.listPosthogIntegrations(teamId),
  'atlas:getPosthogScopeCatalog': (_e: unknown, teamId: string) =>
    atlas.getPosthogScopeCatalog(teamId),
  'atlas:startPosthogOAuth': (_e: unknown, teamId: string, input: atlas.PosthogOAuthInput) =>
    posthogInstall.startInstall(teamId, input),
  'atlas:cancelPosthogOAuth': (_e: unknown, teamId: string) => posthogInstall.cancelPending(teamId),
  'atlas:unbindPosthogIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindPosthogIntegration(teamId, integrationId),
  'atlas:listPosthogAvailableProjects': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.listPosthogAvailableProjects(teamId, integrationId),
  'atlas:updatePosthogProjects': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    projectIds: number[],
  ) => atlas.updatePosthogProjects(teamId, integrationId, projectIds),
  'atlas:getPosthogIntegrationAccess': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.getPosthogIntegrationAccess(teamId, integrationId),
  'atlas:updatePosthogIntegrationAccess': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updatePosthogIntegrationAccess(teamId, integrationId, access),
} as const
