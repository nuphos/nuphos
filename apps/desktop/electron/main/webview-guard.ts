import { app, BrowserWindow, session } from 'electron'

import { CHANGELOG_PAGE_PREFIX } from './changelog-feed.ts'
import { openExternal } from './open-external.ts'

function isHttp(url: string) {
  return /^https?:\/\//i.test(url)
}

/** Sign-in pages that report back to their opener even when opened without window features. */
const SIGN_IN_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com']

/**
 * A popup the page needs as a real window: one asked for with window features
 * (Google, Apple and Microsoft sign-in all do), or a known sign-in page. It
 * keeps `window.opener`, which a page loaded in place has lost.
 */
function isPopup(url: string, disposition: string) {
  if (disposition === 'new-window') return true
  const { hostname, pathname } = new URL(url)

  return (
    SIGN_IN_HOSTS.includes(hostname) || (hostname === 'github.com' && pathname.startsWith('/login'))
  )
}

function openExternally(url: string) {
  openExternal(url).catch((e: unknown) => {
    console.error('[open-external]', url, e)
  })
}

/** Browser guests use an isolated persistent session; the reader stays restricted. */
export function initWebviewGuard() {
  const browserSession = session.fromPartition('persist:browser')

  // Remote pages cannot gain device, clipboard, or other permissions implicitly.
  // Keep both paths denied until the browser has an explicit permission UI.
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setDevicePermissionHandler(() => false)
  // Sites that remember a trusted browser (Apple ID) bind it to the user agent, so drop the
  // app and Electron tokens that change with every release and present plain Chrome.
  browserSession.setUserAgent(
    browserSession
      .getUserAgent()
      .replace(/ ([^\s/()]+)\/\S+/g, (token, product: string) =>
        ['AppleWebKit', 'Chrome', 'Safari'].includes(product) ? token : '',
      ),
  )

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

    // Session identity remains stable during redirects and failed navigation.
    const browser = contents.session === browserSession

    // Browser popups are windows in the browser session and get the same guard.
    if (contents.getType() !== 'webview' && !browser) return
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (browser ? isHttp(url) : url.startsWith(CHANGELOG_PAGE_PREFIX)) return
      event.preventDefault()
      if (!browser) openExternally(url)
    }

    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (browser && isHttp(url) && isPopup(url, disposition))
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent:
              BrowserWindow.fromWebContents(contents.hostWebContents ?? contents) ?? undefined,
            autoHideMenuBar: true,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        }
      if (browser && isHttp(url))
        void contents.loadURL(url).catch(() => {
          // The guest's did-fail-load event displays navigation failures.
        })
      else if (!browser) openExternally(url)

      return { action: 'deny' }
    })
    // A popup outliving its tab has no page left to sign in.
    contents.on('did-create-window', (popup) => {
      contents.once('destroyed', () => {
        if (!popup.isDestroyed()) popup.close()
      })
    })
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
  })
}
