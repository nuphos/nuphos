import { ipcRenderer } from 'electron'

import type { BindingShare } from '../../src/lib/bindingShare'

export const teamOAuthApi = {
  atlasStartGithubInstall: (teamId: string, share?: BindingShare) =>
    ipcRenderer.invoke('atlas:startGithubInstall', teamId, share),
  atlasStartGitlabOAuth: (
    teamId: string,
    hostUrl: string,
    clientId?: string,
    clientSecret?: string,
    scopes?: string[],
    share?: BindingShare,
  ) =>
    ipcRenderer.invoke(
      'atlas:startGitlabOAuth',
      teamId,
      hostUrl,
      clientId,
      clientSecret,
      scopes,
      share,
    ),
  atlasCancelGitlabOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelGitlabOAuth', teamId),
  atlasStartCloudflareConnect: (teamId: string, scopes?: string[], share?: BindingShare) =>
    ipcRenderer.invoke('atlas:startCloudflareConnect', teamId, scopes, share),
  atlasCancelCloudflareConnect: (teamId: string) =>
    ipcRenderer.invoke('atlas:cancelCloudflareConnect', teamId),
  atlasStartLinearOAuth: (teamId: string, share?: BindingShare) =>
    ipcRenderer.invoke('atlas:startLinearOAuth', teamId, share),
  atlasCancelLinearOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelLinearOAuth', teamId),
  atlasStartJiraOAuth: (teamId: string, share?: BindingShare) =>
    ipcRenderer.invoke('atlas:startJiraOAuth', teamId, share),
  atlasCancelJiraOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelJiraOAuth', teamId),
  atlasStartAsanaOAuth: (teamId: string, share?: BindingShare) =>
    ipcRenderer.invoke('atlas:startAsanaOAuth', teamId, share),
  atlasCancelAsanaOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelAsanaOAuth', teamId),
  atlasStartSentryOAuth: (teamId: string, share?: BindingShare) =>
    ipcRenderer.invoke('atlas:startSentryOAuth', teamId, share),
  atlasCancelSentryOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelSentryOAuth', teamId),
}
