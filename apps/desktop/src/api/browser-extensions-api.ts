import type { AnchorRect } from './browser-extension-types.ts'

export const browserExtensionsApi = {
  browserExtensions: (tabId: number) => window.api.browserExtensions(tabId),
  browserExtensionAdd: (id: string) => window.api.browserExtensionAdd(id),
  browserExtensionRemove: (id: string) => window.api.browserExtensionRemove(id),
  browserExtensionActivate: (id: string, tabId: number, anchor: AnchorRect) =>
    window.api.browserExtensionActivate(id, tabId, anchor),
  browserExtensionSelectTab: (tabId: number) => window.api.browserExtensionSelectTab(tabId),
  onBrowserExtensionsChanged: (callback: () => void) =>
    window.api.onBrowserExtensionsChanged(callback),
}
