// The browser toolbar's view of the extensions, and its actions.
import path from 'node:path'

import { nativeImage, webContents } from 'electron'

import { extensionHost } from './host.ts'
import { browserSession, failed, install, pinned, remove, setPinned } from './manage.ts'
import { isExtensionId } from './store.ts'

import type { BrowserExtensionItem } from '../../../src/api/browser-extension-types.ts'
import type { IpcMainInvokeEvent } from 'electron'

type Icons = Record<string, string | undefined>

/** The extension's toolbar icon, else its largest icon up to 64 px, as a data URL. */
function iconOf(extension: Electron.Extension): string | null {
  const manifest = extension.manifest as {
    icons?: Icons
    action?: { default_icon?: string | Icons }
    browser_action?: { default_icon?: string | Icons }
  }
  const declared = manifest.action?.default_icon ?? manifest.browser_action?.default_icon
  const icons: Icons =
    typeof declared === 'string' ? { '32': declared } : { ...manifest.icons, ...declared }
  const sizes = Object.keys(icons)
    .map(Number)
    .filter((size) => size > 0)
    .sort((a, b) => a - b)
  const size = sizes.findLast((n) => n <= 64) ?? sizes.at(0)
  const file = size === undefined ? undefined : icons[String(size)]

  if (!file) return null
  const resolved = path.resolve(extension.path, file.replace(/^\//, ''))

  if (!resolved.startsWith(extension.path + path.sep)) return null
  const image = nativeImage.createFromPath(resolved)

  return image.isEmpty() ? null : image.toDataURL()
}

function list(tabId: number): BrowserExtensionItem[] {
  const state = extensionHost()?.action.getState() ?? { actions: [] }
  const loaded = browserSession()
    .extensions.getAllExtensions()
    .map((extension): BrowserExtensionItem => {
      const action = state.actions.find((candidate) => candidate.id === extension.id)
      const forTab = action?.tabs[String(tabId)]
      const text = forTab?.text ?? action?.text ?? ''

      return {
        id: extension.id,
        name: extension.name,
        icon: iconOf(extension),
        pinned: pinned.has(extension.id),
        badge: text ? { text, color: forTab?.color ?? action?.color ?? null } : null,
        error: null,
      }
    })
  const turnedOff = [...failed].map(([id, { name, error }]): BrowserExtensionItem => ({
    id,
    name,
    icon: null,
    pinned: false,
    badge: null,
    error,
  }))

  return [...loaded, ...turnedOff].sort((a, b) => a.name.localeCompare(b.name))
}

/** A Dock browser tab in the user's session, by its web contents ID. */
function dockTab(id: unknown) {
  const tab = typeof id === 'number' ? webContents.fromId(id) : undefined

  return tab && !tab.isDestroyed() && tab.session === browserSession() ? tab : null
}

const finite = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

function extensionId(id: unknown) {
  if (!isExtensionId(id)) throw new TypeError('Not an extension ID')

  return id
}

export const browserExtensionChannels = {
  /** Null for a tab outside the user's browser session (an agent's): it has no extensions. */
  'browser-extensions:list': (_event: IpcMainInvokeEvent, tabId: unknown) => {
    const tab = dockTab(tabId)

    return tab ? list(tab.id) : null
  },
  // Without a running host the package's APIs are ungated, so nothing new may load.
  'browser-extensions:add': (_event: IpcMainInvokeEvent, id: unknown) => {
    if (!extensionHost()) throw new Error('Browser extensions are unavailable')

    return install(extensionId(id))
  },
  'browser-extensions:remove': (_event: IpcMainInvokeEvent, id: unknown) => remove(extensionId(id)),
  'browser-extensions:pin': (_event: IpcMainInvokeEvent, id: unknown, pin: unknown) =>
    setPinned(extensionId(id), pin === true),
  /** Opens the extension's popup under its toolbar button, or sends it the click. */
  'browser-extensions:activate': (
    _event: IpcMainInvokeEvent,
    id: unknown,
    tabId: unknown,
    anchor: unknown,
  ) => {
    const tab = dockTab(tabId)
    const host = extensionHost()
    const { x, y, width, height } = (anchor ?? {}) as Record<string, unknown>

    if (!tab || !host) return
    host.extensions.selectTab(tab)
    host.action.activateClick({
      extensionId: extensionId(id),
      tabId: tab.id,
      anchorRect: { x: finite(x), y: finite(y), width: finite(width), height: finite(height) },
    })
  },
  /** The tab the user is looking at, so extensions see the right active tab. */
  'browser-extensions:select-tab': (_event: IpcMainInvokeEvent, tabId: unknown) => {
    const tab = dockTab(tabId)

    if (tab) extensionHost()?.extensions.selectTab(tab)
  },
}
