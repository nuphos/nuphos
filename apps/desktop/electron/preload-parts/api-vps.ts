import { ipcRenderer } from 'electron'

/** Linode and Hetzner accounts. */
export const vpsApi = {
  atlasListLinodeAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listLinodeAccounts', teamId),
  atlasBindLinodeAccount: (teamId: string, label: string, token: string, share?: unknown) =>
    ipcRenderer.invoke('atlas:bindLinodeAccount', teamId, label, token, share),
  atlasUnbindLinodeAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindLinodeAccount', teamId, accountId),
  atlasListHetznerAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listHetznerAccounts', teamId),
  atlasBindHetznerAccount: (teamId: string, label: string, token: string, share?: unknown) =>
    ipcRenderer.invoke('atlas:bindHetznerAccount', teamId, label, token, share),
  atlasUnbindHetznerAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindHetznerAccount', teamId, accountId),
  atlasListHetznerServers: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listHetznerServers', teamId, accountId),
}
