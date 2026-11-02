import { ipcRenderer } from 'electron'

// Signing in, and the signed-in member's own sign-ins (Settings → Account → Signed-in devices).
export const signInSessionsApi = {
  authSocialProviders: () => ipcRenderer.invoke('auth:socialProviders'),
  authLogin: (provider: string) => ipcRenderer.invoke('auth:login', provider),
  authCancel: () => ipcRenderer.invoke('auth:cancel'),
  authEmailRequestCode: (email: string) => ipcRenderer.invoke('auth:emailRequestCode', email),
  authEmailVerifyCode: (email: string, code: string) =>
    ipcRenderer.invoke('auth:emailVerifyCode', email, code),
  atlasListSignInSessions: () => ipcRenderer.invoke('atlas:listSignInSessions'),
  atlasSignOutSession: (id: string) => ipcRenderer.invoke('atlas:signOutSession', id),
  atlasSignOutOtherSessions: () => ipcRenderer.invoke('atlas:signOutOtherSessions'),
}
