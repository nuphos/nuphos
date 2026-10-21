import { Children, isValidElement } from 'react'

import { localUrl } from './panel/localUrls.ts'

import type { ReactNode } from 'react'

export type LinkRenderOptions = { standalone?: boolean }

/** Promote a link-only paragraph; words around an inline link must stay in place. */
export function standaloneLocalLink(children: ReactNode) {
  let link: { href: string; children: ReactNode } | undefined

  for (const node of Children.toArray(children)) {
    if (typeof node === 'string') {
      if (link ? !/^[\s.!?]*$/.test(node) : Boolean(node.trim())) return null
      continue
    }
    if (link || !isValidElement<{ href?: unknown; children?: ReactNode }>(node)) return null
    const { href, children: label } = node.props

    if (typeof href !== 'string' || !localUrl(href)) return null
    link = { href, children: label }
  }

  return link ?? null
}
