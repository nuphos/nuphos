import { AtlasMentionInline } from './messageInline'

import type { ReactNode } from 'react'
import { isAppWebUrl } from '../../../lib/webBaseUrl'

// The composer serializes mention chips back to their raw Nuphos URL, so by the
// time a sent message reaches the transcript it's plain text. GFM autolinks the
// bare URL; this hook swaps the resulting anchor for the same chip the composer
// used (returning null keeps the default anchor for everything else).
// Only bare autolinks should become chips; leave explicit `[label](url)`
// markdown links alone so user-authored link text is preserved.
export function flattenLinkText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenLinkText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return flattenLinkText((node as { props?: { children?: ReactNode } }).props?.children)
  }

  return ''
}

export function renderAtlasMentionLink(
  href: string,
  children: ReactNode,
  onOpen?: (href: string) => boolean,
): ReactNode | null {
  if (!isAppWebUrl(href)) return null
  if (flattenLinkText(children).trim() !== href) return null

  return <AtlasMentionInline url={href} onOpen={onOpen} />
}
