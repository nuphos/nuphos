import type { AnchorRect, BrowserExtensionItem } from '../../api/browser-extension-types'

type Activate = (id: string, tabId: number, anchor: AnchorRect) => Promise<void>

/**
 * A click on an extension, from its toolbar button or its Extensions menu row, pinned or not:
 * it runs, as in Chrome, with its popup under `anchor`. A turned-off one can't. The main
 * process logs why one didn't open.
 */
export function runExtension(
  activate: Activate,
  item: BrowserExtensionItem,
  tabId: number,
  anchor: Element,
): boolean {
  if (item.error) return false
  const { x, y, width, height } = anchor.getBoundingClientRect()

  activate(item.id, tabId, { x, y, width, height }).catch(() => {
    // Written to browser-extensions.log by the main process.
  })

  return true
}
