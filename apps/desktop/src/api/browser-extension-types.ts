/** A Chrome extension in the Dock browser, as its toolbar and menu show it. */
export type BrowserExtensionItem = {
  id: string
  name: string
  /** Its toolbar icon as a data URL. */
  icon: string | null
  /** Its badge on the tab the list was asked for. */
  badge: { text: string; color: string | null } | null
  /** Why it is not loaded: its files differ from the Chrome Web Store's. */
  error: string | null
}

export type AnchorRect = { x: number; y: number; width: number; height: number }
