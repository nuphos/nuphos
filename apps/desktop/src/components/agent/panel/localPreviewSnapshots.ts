import { localUrl } from './localUrls.ts'

export type PreviewScope = { userId: string; teamId: string }
export type LocalPreviewSnapshot = { image: string; title: string }

const MAX_IMAGES = 12
const MAX_IMAGE_LENGTH = 512 * 1024

/** Unlike prose-link detection, capture identity never trims URL punctuation. */
export function localPreviewHref(href: string): string | null {
  try {
    const url = new URL(href)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || !localUrl(url.origin)) return null

    return url.href
  } catch {
    return null
  }
}

function key(scope: PreviewScope | undefined, href: string): string | null {
  const url = localPreviewHref(href)

  return scope?.userId && scope.teamId && url
    ? JSON.stringify([scope.userId, scope.teamId, url])
    : null
}

/** Device memory only: snapshots never enter chat storage or uploads. */
export function createLocalPreviewSnapshots() {
  const images = new Map<string, { owner: symbol; value: LocalPreviewSnapshot }>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  const removeOwner = (owner: symbol) => {
    let changed = false

    for (const [id, entry] of images) {
      if (entry.owner !== owner) continue
      images.delete(id)
      changed = true
    }

    return changed
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    get(scope: PreviewScope | undefined, href: string) {
      return images.get(key(scope, href) ?? '')?.value
    },
    publish(owner: symbol, scope: PreviewScope, href: string, value: LocalPreviewSnapshot) {
      const id = key(scope, href)

      if (!id || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(value.image))
        return false
      if (value.image.length > MAX_IMAGE_LENGTH) return false
      removeOwner(owner)
      images.delete(id)
      images.set(id, { owner, value })
      const oldest = images.keys().next().value

      if (images.size > MAX_IMAGES && oldest) images.delete(oldest)
      notify()

      return true
    },
    clear(owner: symbol) {
      if (removeOwner(owner)) notify()
    },
  }
}

export const localPreviewSnapshots = createLocalPreviewSnapshots()
