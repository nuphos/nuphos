import { Fragment } from 'react'
import type { ReactNode } from 'react'

/** Splits a translated sentence on `{name}` placeholders and drops in the nodes. */
export function withNodes(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text
    .split(/(\{\w+\})/)
    .map((part, i) => <Fragment key={i}>{nodes[part.slice(1, -1)] ?? part}</Fragment>)
}
