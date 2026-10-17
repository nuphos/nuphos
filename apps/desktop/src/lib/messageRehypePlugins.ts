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

const code = (path: string): Node => ({
  type: 'element',
  tagName: 'code',
  children: [{ type: 'text', value: path }],
})

// A link is never descended into, so a path that is already the label of an
// explicit link keeps that link's destination.
function linkPaths(node: Node) {
  node.children = node.children?.flatMap((child): Node[] => {
    if (child.type === 'text' && child.value)
      return splitRuntimeFilePaths(child.value).map((part) =>
        typeof part === 'string'
          ? { type: 'text', value: part }
          : link(part.path, [{ type: 'text', value: part.path }]),
      )
    if (child.type !== 'element' || child.tagName === 'a') return [child]

    const value = text(child).trim()

    if (child.tagName === 'code') return isRuntimeFilePath(value) ? [link(value, [child])] : [child]
    if (child.tagName === 'pre') {
      // A block of nothing but paths becomes a line of linked paths each;
      // anything else stays a highlighted code block.
      const lines = value.split('\n').map((line) => line.trim())

      if (!lines.every(isRuntimeFilePath)) return [child]

      return [
        {
          type: 'element',
          tagName: 'p',
          children: lines.flatMap((line, i) => [
            ...(i ? [{ type: 'element', tagName: 'br', children: [] }] : []),
            link(line, [code(line)]),
          ]),
        },
      ]
    }
    linkPaths(child)

    return [child]
  })
}

/** Links bare runtime paths in prose, inline code and path-only code blocks. */
const rehypeRuntimeFilePaths = () => linkPaths

// Without `harden`: sanitize already drops unsafe protocols, and with every
// prefix allowed harden only rewrote `./a` to `/a` and blocked bare `a`, which
// is how agents cite files relative to their workspace.
export const messageRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  rehypeRuntimeFilePaths,
]
