import {
  localPreviewHref,
  localPreviewSnapshots,
} from '../../components/agent/panel/localPreviewSnapshots.ts'

import type { PreviewScope } from '../../components/agent/panel/localPreviewSnapshots.ts'
import type { WebviewTag } from 'electron'

type PreviewPage = Pick<WebviewTag, 'getURL' | 'getTitle' | 'capturePage'>

/** Capture only a page the user or agent already opened in the browser pane. */
export function localPreviewRecorder(view: PreviewPage, scope?: PreviewScope) {
  const owner = Symbol('browser preview')
  let currentScope = scope
  let generation = 0
  let disposed = false
  const invalidate = () => {
    generation += 1
    localPreviewSnapshots.clear(owner)
  }

  const capture = async () => {
    if (!currentScope || disposed) return
    const request = ++generation

    try {
      const href = view.getURL()
      const url = localPreviewHref(href)

      if (!url) return
      const image = await view.capturePage()

      if (disposed || request !== generation || view.getURL() !== href || image.isEmpty()) return
      localPreviewSnapshots.publish(owner, currentScope, url, {
        title: view.getTitle(),
        image: image.resize({ width: Math.min(960, image.getSize().width) }).toDataURL(),
      })
    } catch {
      // An offscreen or closed guest leaves a working link without a thumbnail.
    }
  }

  return {
    invalidate,
    setScope(next: PreviewScope | undefined) {
      if (next?.userId === currentScope?.userId && next?.teamId === currentScope?.teamId) return
      invalidate()
      currentScope = next
    },
    capture,
    async navigatedInPage(active: boolean) {
      invalidate()
      if (active) await capture()
    },
    dispose() {
      disposed = true
      invalidate()
    },
  }
}
