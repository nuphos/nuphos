import type { BindingAccess } from '../types/k8s-core.ts'
import type { PosthogOAuthInput } from '../types/posthog.ts'

export const posthogApi = {
  atlasListPosthogIntegrations: (teamId: string) => window.api.atlasListPosthogIntegrations(teamId),
  atlasGetPosthogScopeCatalog: (teamId: string) => window.api.atlasGetPosthogScopeCatalog(teamId),
  atlasStartPosthogOAuth: (teamId: string, input: PosthogOAuthInput) =>
    window.api.atlasStartPosthogOAuth(teamId, input),
  atlasCancelPosthogOAuth: (teamId: string) => window.api.atlasCancelPosthogOAuth(teamId),
  atlasUnbindPosthogIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindPosthogIntegration(teamId, integrationId),
  atlasListPosthogAvailableProjects: (teamId: string, integrationId: string) =>
    window.api.atlasListPosthogAvailableProjects(teamId, integrationId),
  atlasUpdatePosthogProjects: (teamId: string, integrationId: string, projectIds: number[]) =>
    window.api.atlasUpdatePosthogProjects(teamId, integrationId, projectIds),
  atlasGetPosthogIntegrationAccess: (teamId: string, integrationId: string) =>
    window.api.atlasGetPosthogIntegrationAccess(teamId, integrationId),
  atlasUpdatePosthogIntegrationAccess: (
    teamId: string,
    integrationId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdatePosthogIntegrationAccess(teamId, integrationId, access),
}
