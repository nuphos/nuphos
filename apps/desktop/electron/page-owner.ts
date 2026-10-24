import type { WebContents } from 'electron'

/**
 * Run `release` once the page that owns some main-process state is gone: its
 * window closed, its renderer crashed, or its main frame loaded a new document,
 * a reload included. A reload keeps the same WebContents, so state tied only to
 * 'destroyed' outlives the page that could have released it. Returns a function
 * that unregisters without running `release`.
 */
export function onPageGone(owner: WebContents, release: () => void): () => void {
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) gone()
  }
  const off = () => {
    owner.off('destroyed', gone)
    owner.off('render-process-gone', gone)
    owner.off('did-start-navigation', onNavigation)
  }

  function gone() {
    off()
    release()
  }

  owner.on('destroyed', gone)
  owner.on('render-process-gone', gone)
  owner.on('did-start-navigation', onNavigation)

  return off
}
