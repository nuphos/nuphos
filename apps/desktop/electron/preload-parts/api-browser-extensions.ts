import { ipcRenderer } from 'electron'

import type { AnchorRect, BrowserExtensionItem } from '../../src/api/browser-extension-types'

export const browserExtensionsApi = {
  /** The extensions for a Dock tab, or null when the tab can't have any (an agent's tab). */
  browserExtensions: (tabId: number): Promise<BrowserExtensionItem[] | null> =>
    ipcRenderer.invoke('browser-extensions:list', tabId),
  /** Asks the user first; resolves false when they say no. */
  browserExtensionAdd: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('browser-extensions:add', id),
  browserExtensionRemove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('browser-extensions:remove', id),
  browserExtensionPin: (id: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke('browser-extensions:pin', id, pinned),
  browserExtensionActivate: (id: string, tabId: number, anchor: AnchorRect): Promise<void> =>
    ipcRenderer.invoke('browser-extensions:activate', id, tabId, anchor),
  browserExtensionSelectTab: (tabId: number): Promise<void> =>
    ipcRenderer.invoke('browser-extensions:select-tab', tabId),
  onBrowserExtensionsChanged: (callback: () => void) => {
    const handler = () => callback()

    ipcRenderer.on('browser-extensions:changed', handler)

    return () => ipcRenderer.off('browser-extensions:changed', handler)
  },
}
