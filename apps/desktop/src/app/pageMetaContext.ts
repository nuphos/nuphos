import { createContext } from 'react'

export type PageMetaInput = {
  pageKey: string
  title: string
  icon: React.ReactNode
  /** Stable identity for icons that can change without a title/navigation change. */
  iconKey?: string
  canonicalHref: string
}

export type PageMetaContextValue = {
  canonicalHref: string
  setPageMeta: (meta: PageMetaInput) => void
}

export const PageMetaContext = createContext<PageMetaContextValue | null>(null)
