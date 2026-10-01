import type { ComponentType, ReactNode } from 'react'

type AnsiComponent = ComponentType<{
  children?: ReactNode
  className?: string
}>

export function resolveAnsiComponent(candidate: unknown): AnsiComponent {
  if (typeof candidate === 'function') return candidate as AnsiComponent
  if (
    candidate &&
    typeof candidate === 'object' &&
    'default' in candidate &&
    typeof candidate.default === 'function'
  ) {
    return candidate.default as AnsiComponent
  }

  throw new TypeError('ansi-to-react did not export a React component')
}
