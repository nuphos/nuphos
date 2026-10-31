type Root = Pick<ParentNode, 'querySelectorAll'>

/**
 * The dock tab showing a browser guest, by its webContents id: the one id the
 * main process knows a `local_browser` tab by. Every browser tab stays mounted,
 * in whichever conversation's dock, so its webview is in the document.
 */
export function dockTabOfWebContents(id: number, root: Root = document): string | undefined {
  for (const view of root.querySelectorAll<Element & { getWebContentsId?: () => number }>(
    'webview',
  )) {
    if (view.getWebContentsId?.() !== id) continue

    return view.closest<HTMLElement>('[data-workspace-tab]')?.dataset.workspaceTab
  }

  return undefined
}
