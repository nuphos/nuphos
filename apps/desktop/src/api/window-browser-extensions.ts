import type { AnchorRect, BrowserExtensionItem } from './browser-extension-types.ts'

export type WindowBrowserExtensionsApi = {
  browserExtensions: (tabId: number) => Promise<BrowserExtensionItem[] | null>
  browserExtensionAdd: (id: string) => Promise<boolean>
  browserExtensionRemove: (id: string) => Promise<boolean>
  browserExtensionPin: (id: string, pinned: boolean) => Promise<void>
  browserExtensionActivate: (id: string, tabId: number, anchor: AnchorRect) => Promise<void>
  browserExtensionSelectTab: (tabId: number) => Promise<void>
  onBrowserExtensionsChanged: (callback: () => void) => () => void
}
