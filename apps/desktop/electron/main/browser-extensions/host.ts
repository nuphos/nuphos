// Chrome extension APIs in the Dock browser's session (`persist:browser`) only.
import { app, BrowserWindow, webContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'

import { logError, uncaughtException } from './log.ts'
import { browserSession, checkForUpdates, confirm, loadInstalled, notifyChanged } from './manage.ts'
import { builtInHosts, manifestDirs, nativeMessaging } from './native-messaging.ts'
import { addedAccess } from './warnings.ts'

import type { ExtensionManifest } from './warnings.ts'

/** Updates wait a while after launch, so an update never races the extensions starting up. */
const FIRST_UPDATE_CHECK_MS = 5 * 60_000
const UPDATE_CHECK_MS = 5 * 60 * 60_000

/** API namespaces the package serves to every extension; Chrome requires these permissions. */
const GATED: Record<string, string | undefined> = {
  cookies: 'cookies',
  webNavigation: 'webNavigation',
  notifications: 'notifications',
  contextMenus: 'contextMenus',
}

type Router = {
  handlers: Map<string, { permission?: string }>
  handle: (name: string, callback: unknown, options: { permission: string }) => void
  addListener: (listener: unknown, extensionId: string, eventName: string) => unknown
}
export type BrowserActionApi = {
  getState: () => {
    actions: {
      id: string
      text?: string
      color?: string
      tabs: Record<string, { text?: string; color?: string } | undefined>
    }[]
  }
  activateClick: (details: {
    extensionId: string
    tabId: number
    anchorRect: { x: number; y: number; width: number; height: number }
  }) => void
  observers: Set<unknown>
}

let host: { extensions: ElectronChromeExtensions; action: BrowserActionApi } | null = null
const extensionWindows = new WeakSet<BrowserWindow>()

/** The running extension host, or null before it starts or when it failed to. */
export const extensionHost = () => host

/** The package's private parts this file relies on, checked so a version bump fails loudly. */
function internals(extensions: ElectronChromeExtensions) {
  const inner = extensions as unknown as {
    ctx?: { router?: Router }
    api?: { browserAction?: BrowserActionApi }
  }
  const router = inner.ctx?.router
  const action = inner.api?.browserAction

  if (
    !(router?.handlers instanceof Map) ||
    typeof router.handle !== 'function' ||
    typeof router.addListener !== 'function' ||
    typeof action?.getState !== 'function' ||
    typeof action.activateClick !== 'function' ||
    !(action.observers instanceof Set)
  )
    throw new Error('electron-chrome-extensions changed its internals; check host.ts')

  return { router, action }
}

function hasPermission(extensionId: string, name: string) {
  const permission = GATED[name.split('.')[0]]
  const manifest = browserSession().extensions.getExtension(extensionId)?.manifest as
    ExtensionManifest | undefined

  return !permission || (manifest?.permissions ?? []).includes(permission)
}

/**
 * Chrome requires a permission for these namespaces; the package does not
 * check it. Its native messaging is replaced by ./native-messaging.ts.
 */
function gateApis(router: Router) {
  for (const [name, handler] of router.handlers) {
    const permission = GATED[name.split('.')[0]]

    if (permission) handler.permission = permission
    if (/^runtime\.\w*Native/.test(name)) router.handlers.delete(name)
  }
  const addListener = router.addListener.bind(router)

  router.addListener = (listener, extensionId, eventName) =>
    hasPermission(extensionId, eventName)
      ? addListener(listener, extensionId, eventName)
      : undefined
}

/** Pages an extension opens (its welcome page, a pop-out, options) get a window of their own. */
function openExtensionWindow(
  url: string | undefined,
  bounds: { width?: number; height?: number; left?: number; top?: number } = {},
) {
  const window = new BrowserWindow({
    width: bounds.width ?? 1000,
    height: bounds.height ?? 760,
    x: bounds.left,
    y: bounds.top,
    autoHideMenuBar: true,
    webPreferences: {
      session: browserSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  extensionWindows.add(window)
  host?.extensions.addTab(window.webContents, window)
  window.loadURL(url ?? 'about:blank').catch(() => {
    // The window shows its own load error.
  })

  return window
}

function closeExtensionWindow(window: unknown) {
  if (window instanceof BrowserWindow && extensionWindows.has(window) && !window.isDestroyed())
    window.close()
}

/** Starts the extension host on the Dock browser's session and loads installed extensions. */
export async function initBrowserExtensions(): Promise<void> {
  const browser = browserSession()
  const extensions = new ElectronChromeExtensions({
    session: browser,
    createTab: (details: { url?: string }) => {
      const window = openExtensionWindow(details.url)

      return Promise.resolve([window.webContents, window])
    },
    removeTab: (_tab, window) => closeExtensionWindow(window),
    createWindow: (details: {
      url?: string | string[]
      width?: number
      height?: number
      left?: number
      top?: number
    }) =>
      Promise.resolve(
        openExtensionWindow(Array.isArray(details.url) ? details.url[0] : details.url, details),
      ),
    removeWindow: closeExtensionWindow,
    // An optional permission an extension asks for later gets the same kind of question.
    requestPermissions: (extension, permissions: { permissions?: string[]; origins?: string[] }) =>
      confirm(
        'Extension permissions',
        `"${extension.name}" wants more access`,
        addedAccess(
          {},
          { permissions: permissions.permissions, host_permissions: permissions.origins },
        ),
        'Allow',
      ),
  })
  const { router, action } = internals(extensions)

  host = { extensions, action }
  gateApis(router)
  // Only allow-listed password managers reach their own desktop app.
  const native = nativeMessaging(manifestDirs(), builtInHosts())

  router.handle('runtime.connectNative', native.connectNative, { permission: 'nativeMessaging' })
  router.handle('runtime.disconnectNative', native.disconnectNative, {
    permission: 'nativeMessaging',
  })
  router.handle('runtime.sendNativeMessage', native.sendNativeMessage, {
    permission: 'nativeMessaging',
  })
  browser.extensions.on('extension-unloaded', (_event, extension) => native.closeAll(extension.id))
  app.on('will-quit', () => native.closeAll())
  // A background script that throws stops the whole extension, with nothing else to show for it.
  browser.serviceWorkers.on('console-message', (_event, { message, sourceUrl, lineNumber }) => {
    const uncaught = uncaughtException(message, sourceUrl, lineNumber)

    if (uncaught) logError(uncaught)
  })
  // The package tells observers when a badge or title changes.
  action.observers.add({ isDestroyed: () => false, send: notifyChanged })

  // Dock browser tabs are the extensions' tabs.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-attach-webview', (_attach, guest) => {
      const window = BrowserWindow.fromWebContents(contents)

      if (window && guest.session === browser) extensions.addTab(guest, window)
    })
  })
  for (const contents of webContents.getAllWebContents()) {
    const embedder = contents.hostWebContents as Electron.WebContents | null
    const window = embedder ? BrowserWindow.fromWebContents(embedder) : null

    if (window && contents.session === browser) extensions.addTab(contents, window)
  }

  await loadInstalled()
  setTimeout(() => {
    void checkForUpdates()
    setInterval(() => void checkForUpdates(), UPDATE_CHECK_MS)
  }, FIRST_UPDATE_CHECK_MS)
}
