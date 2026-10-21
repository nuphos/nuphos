import { useCallback } from 'react'

import { LocalUrlChip } from './LocalUrlChip'
import { isBareLocalLink, localUrl } from './localUrls'
import { flattenLinkText } from './messageInlineLinks'

import type { OpenLink } from './LocalUrlChip'
import type { LinkRenderOptions } from '../localPreviewLink'
import type { ReactNode } from 'react'

/** Renders a localhost link in agent text as a chip; other links fall through. A
 *  labelled link keeps its label, which GFM would otherwise drop as synthesized. */
export function useLocalUrlLinks(onOpen?: OpenLink, teamId?: string) {
  return useCallback(
    (href: string, children: ReactNode, options?: LinkRenderOptions): ReactNode | null => {
      const url = localUrl(href)

      if (!url) return null
      const text = flattenLinkText(children).trim()

      return (
        <LocalUrlChip
          url={url}
          label={isBareLocalLink(href, text) || !text ? undefined : text}
          onOpen={onOpen}
          teamId={teamId}
          variant={options?.standalone ? 'card' : 'inline'}
        />
      )
    },
    [onOpen, teamId],
  )
}
