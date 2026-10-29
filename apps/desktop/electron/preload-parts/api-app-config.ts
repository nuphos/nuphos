import { ipcRenderer } from 'electron'

import { ALLOWED_WEB_HOSTS, WEB_BASE_URL } from '../web-base-url'

// Resolved in the main process, where process.env exists, and handed to the
// renderer as plain values. Synchronous on purpose: the renderer reads the base
// URL inside link-rendering paths that cannot await.
export const appConfigApi = {
  claimFirstLaunchIntro: (): Promise<boolean> => ipcRenderer.invoke('app:claimFirstLaunchIntro'),
  // "Send crash reports and usage data" (main process owns the setting).
  sendDiagnostics: (): boolean => ipcRenderer.sendSync('diagnostics:enabled') === true,
  setSendDiagnostics: (send: boolean): Promise<boolean> =>
    ipcRenderer.invoke('diagnostics:set', send),
  onSendDiagnosticsChanged: (listener: (send: boolean) => void): (() => void) => {
    const handler = (_event: unknown, send: boolean) => listener(send)

    ipcRenderer.on('diagnostics:changed', handler)

    return () => ipcRenderer.off('diagnostics:changed', handler)
  },
  appGetAppIcon: (): Promise<string> => ipcRenderer.invoke('app:getAppIcon'),
  appSetAppIcon: (icon: string): Promise<void> => ipcRenderer.invoke('app:setAppIcon', icon),
  webBaseUrl: WEB_BASE_URL,
  allowedWebHosts: [...ALLOWED_WEB_HOSTS],
}
