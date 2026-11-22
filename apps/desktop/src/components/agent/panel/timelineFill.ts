import { createElement, Fragment } from 'react'

import type { ReactNode } from 'react'

/** Puts the people and runtimes into a translated sentence where its
 *  `{placeholders}` are, so each language keeps its own word order. */
export function fill(text: string, nodes: Record<string, ReactNode>) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const node = nodes[part.slice(1, -1)]

    return createElement(Fragment, { key: i }, part.startsWith('{') && node ? node : part)
  })
}
