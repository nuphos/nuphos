import { app, session, shell } from 'electron'

import { CHANGELOG_PAGE_PREFIX } from './changelog-feed.ts'

function isHttp(url: string) {
  return /^https?:\/\//i.test(url)
}

function openExternally(url: string) {
  if (isHttp(url)) void shell.openExternal(url)
}

/** Browser guests use an isolated persistent session; the reader stays restricted. */
export function initWebviewGuard() {
  const browserSession = session.fromPartition('persist:browser')

  // Remote pages cannot gain device, clipboard, or other permissions implicitly.
  // Keep both paths denied until the browser has an explicit permission UI.
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setDevicePermissionHandler(() => false)

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const allowed =
        params.partition === 'persist:browser'
          ? isHttp(params.src)
          : params.src.startsWith(CHANGELOG_PAGE_PREFIX)

      if (!allowed) {
        event.preventDefault()

        return
      }
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
    })

    if (contents.getType() !== 'webview') return
    // Session identity remains stable during redirects and failed navigation.
    const browser = contents.session === browserSession
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (browser ? isHttp(url) : url.startsWith(CHANGELOG_PAGE_PREFIX)) return
      event.preventDefault()
      if (!browser) openExternally(url)
    }

    contents.setWindowOpenHandler(({ url }) => {
      if (browser && isHttp(url))
        void contents.loadURL(url).catch(() => {
          // The guest's did-fail-load event displays navigation failures.
        })
      else if (!browser) openExternally(url)

      return { action: 'deny' }
    })
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
  })
}
