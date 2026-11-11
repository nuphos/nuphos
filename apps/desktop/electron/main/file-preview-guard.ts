// An HTML file preview (src/components/agent/artifacts/filePreviewSandbox.ts)
// runs no script and loads nothing, but a plain link could still navigate its
// frame to a page on the web. A frame by this name only ever shows its srcdoc.

import type { WebContents } from 'electron'

export const FILE_PREVIEW_FRAME_NAME = 'nuphos-file-preview'

const OWN_DOCUMENT = new Set(['about:srcdoc', 'about:blank'])

export function blocksFilePreviewNavigation(details: {
  isMainFrame: boolean
  frameName: string | null | undefined
  url: string
}): boolean {
  return (
    !details.isMainFrame &&
    details.frameName === FILE_PREVIEW_FRAME_NAME &&
    !OWN_DOCUMENT.has(details.url)
  )
}

/** Holds every file preview frame in `contents` to its own document. */
export function guardFilePreviewFrames(contents: WebContents): void {
  contents.on('will-frame-navigate', (event) => {
    const frameName = event.frame?.name

    if (blocksFilePreviewNavigation({ isMainFrame: event.isMainFrame, frameName, url: event.url }))
      event.preventDefault()
  })
}
