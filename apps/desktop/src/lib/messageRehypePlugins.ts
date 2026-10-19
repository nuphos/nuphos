import { defaultRehypePlugins } from 'streamdown'

import { isRuntimeFilePath, splitRuntimeFilePaths } from './runtimeFileLink.ts'

type Node = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  value?: string
  children?: Node[]
}

const text = (node: Node): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(text).join('')

const link = (path: string, children: Node[]): Node => ({
  type: 'element',
  tagName: 'a',
  properties: { href: path },
  children,
})

// A link is never descended into, so a path that is already the label of an
// explicit link keeps that link's destination. A code block is left exactly
// as written.
function linkPaths(node: Node) {
  node.children = node.children?.flatMap((child): Node[] => {
    if (child.type === 'text' && child.value)
      return splitRuntimeFilePaths(child.value).map((part) =>
        typeof part === 'string'
          ? { type: 'text', value: part }
          : link(part.path, [{ type: 'text', value: part.path }]),
      )
    if (child.type !== 'element' || child.tagName === 'a' || child.tagName === 'pre') return [child]
    if (child.tagName === 'code') {
      const value = text(child).trim()

      return isRuntimeFilePath(value) ? [link(value, [child])] : [child]
    }
    linkPaths(child)

    return [child]
  })
}

/** Links bare runtime paths in prose and path-only inline code. */
const rehypeRuntimeFilePaths = () => linkPaths

// Without `harden`: sanitize already drops unsafe protocols, and with every
// prefix allowed harden only rewrote `./a` to `/a` and blocked bare `a`, which
// is how agents cite files relative to their workspace.
export const messageRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  rehypeRuntimeFilePaths,
]
