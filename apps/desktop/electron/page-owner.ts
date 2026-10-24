import type { WebContents } from 'electron'

type Page = { releases: Set<() => void>; detach: () => void }

/** One listener set per page, however many subscriptions it owns. */
const pages = new WeakMap<WebContents, Page>()

function watch(owner: WebContents): Page {
  const releases = new Set<() => void>()
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) gone()
  }
  const detach = () => {
    pages.delete(owner)
    owner.off('destroyed', gone)
    owner.off('render-process-gone', gone)
    owner.off('did-start-navigation', onNavigation)
  }

  function gone() {
    detach()
    // A release may unregister another one; Set iteration then skips it.
    for (const release of releases) {
      releases.delete(release)
      release()
    }
  }

  owner.on('destroyed', gone)
  owner.on('render-process-gone', gone)
  owner.on('did-start-navigation', onNavigation)
  const page = { releases, detach }

  pages.set(owner, page)

  return page
}

/**
 * Run `release` once the page that owns some main-process state is gone: its
 * window closed, its renderer crashed, or its main frame loaded a new document,
 * a reload included. A reload keeps the same WebContents, so state tied only to
 * 'destroyed' outlives the page that could have released it. Returns a function
 * that unregisters without running `release`.
 */
export function onPageGone(owner: WebContents, release: () => void): () => void {
  const page = pages.get(owner) ?? watch(owner)
  const entry = () => release()

  page.releases.add(entry)

  return () => {
    if (page.releases.delete(entry) && page.releases.size === 0) page.detach()
  }
}
