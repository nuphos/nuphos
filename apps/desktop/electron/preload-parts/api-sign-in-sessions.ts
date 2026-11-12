import { ipcRenderer } from 'electron'

// Signing in, and the signed-in member's own sign-ins and two-factor authentication
// (Settings → Account).
export const signInSessionsApi = {
  authSocialProviders: () => ipcRenderer.invoke('auth:socialProviders'),
  authLogin: (provider: string) => ipcRenderer.invoke('auth:login', provider),
  authCancel: () => ipcRenderer.invoke('auth:cancel'),
  authListAccounts: () => ipcRenderer.invoke('auth:listAccounts'),
  authSwitchAccount: (key: string) => ipcRenderer.invoke('auth:switchAccount', key),
  authSignOutAccount: (key: string) => ipcRenderer.invoke('auth:signOutAccount', key),
  authSignOutAllAccounts: () => ipcRenderer.invoke('auth:signOutAllAccounts'),
  authEmailRequestCode: (email: string) => ipcRenderer.invoke('auth:emailRequestCode', email),
  authEmailVerifyCode: (email: string, code: string) =>
    ipcRenderer.invoke('auth:emailVerifyCode', email, code),
  atlasListSignInSessions: () => ipcRenderer.invoke('atlas:listSignInSessions'),
  atlasSignOutSession: (id: string) => ipcRenderer.invoke('atlas:signOutSession', id),
  atlasSignOutOtherSessions: () => ipcRenderer.invoke('atlas:signOutOtherSessions'),
  authMfaVerify: (mfaToken: string, code: string) =>
    ipcRenderer.invoke('auth:mfaVerify', mfaToken, code),
  atlasGetMfaStatus: () => ipcRenderer.invoke('atlas:getMfaStatus'),
  atlasStartMfaSetup: () => ipcRenderer.invoke('atlas:startMfaSetup'),
  atlasConfirmMfaSetup: (code: string) => ipcRenderer.invoke('atlas:confirmMfaSetup', code),
  atlasNewMfaRecoveryCodes: (code: string) => ipcRenderer.invoke('atlas:newMfaRecoveryCodes', code),
  atlasDisableMfa: (code: string) => ipcRenderer.invoke('atlas:disableMfa', code),
  atlasReauthMfa: (code: string) => ipcRenderer.invoke('atlas:reauthMfa', code),
}
