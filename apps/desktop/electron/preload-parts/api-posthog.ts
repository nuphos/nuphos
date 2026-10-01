import { ipcRenderer } from 'electron'

export const posthogApi = {
  atlasListPosthogIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listPosthogIntegrations', teamId),
  atlasGetPosthogScopeCatalog: (teamId: string) =>
    ipcRenderer.invoke('atlas:getPosthogScopeCatalog', teamId),
  atlasStartPosthogOAuth: (teamId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:startPosthogOAuth', teamId, input),
  atlasCancelPosthogOAuth: (teamId: string) =>
    ipcRenderer.invoke('atlas:cancelPosthogOAuth', teamId),
  atlasUnbindPosthogIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindPosthogIntegration', teamId, integrationId),
  atlasListPosthogAvailableProjects: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:listPosthogAvailableProjects', teamId, integrationId),
  atlasUpdatePosthogProjects: (teamId: string, integrationId: string, projectIds: number[]) =>
    ipcRenderer.invoke('atlas:updatePosthogProjects', teamId, integrationId, projectIds),
  atlasGetPosthogIntegrationAccess: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:getPosthogIntegrationAccess', teamId, integrationId),
  atlasUpdatePosthogIntegrationAccess: (teamId: string, integrationId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updatePosthogIntegrationAccess', teamId, integrationId, access),
}
