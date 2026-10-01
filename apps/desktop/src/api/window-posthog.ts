import type { BindingAccess } from '../types/k8s-core.ts'
import type {
  PosthogIntegration,
  PosthogOAuthInput,
  PosthogOAuthResult,
  PosthogProject,
  PosthogScopeCatalog,
} from '../types/posthog.ts'

export type WindowPosthogApi = {
  atlasListPosthogIntegrations(teamId: string): Promise<PosthogIntegration[]>
  atlasGetPosthogScopeCatalog(teamId: string): Promise<PosthogScopeCatalog>
  atlasStartPosthogOAuth(teamId: string, input: PosthogOAuthInput): Promise<PosthogOAuthResult>
  atlasCancelPosthogOAuth(teamId: string): Promise<void>
  atlasUnbindPosthogIntegration(teamId: string, integrationId: string): Promise<void>
  atlasListPosthogAvailableProjects(
    teamId: string,
    integrationId: string,
  ): Promise<PosthogProject[]>
  atlasUpdatePosthogProjects(
    teamId: string,
    integrationId: string,
    projectIds: number[],
  ): Promise<PosthogIntegration>
  atlasGetPosthogIntegrationAccess(teamId: string, integrationId: string): Promise<BindingAccess>
  atlasUpdatePosthogIntegrationAccess(
    teamId: string,
    integrationId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
}
