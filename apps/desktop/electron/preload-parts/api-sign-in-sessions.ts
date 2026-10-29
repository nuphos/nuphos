import { ipcRenderer } from 'electron'

// The signed-in member's own sign-ins (Settings → Account → Signed-in devices).
export const signInSessionsApi = {
  atlasListSignInSessions: () => ipcRenderer.invoke('atlas:listSignInSessions'),
  atlasSignOutSession: (id: string) => ipcRenderer.invoke('atlas:signOutSession', id),
  atlasSignOutOtherSessions: () => ipcRenderer.invoke('atlas:signOutOtherSessions'),
}
