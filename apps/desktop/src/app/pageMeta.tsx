import { useContext, useEffect } from 'react'

import { PageMetaContext } from './pageMetaContext'

import type { PageMetaInput } from './pageMetaContext'

export type PageMetaProps = Omit<PageMetaInput, 'canonicalHref'> & {
  children: React.ReactNode
}

export function PageMeta({ pageKey, title, icon, iconKey, children }: PageMetaProps) {
  const pageMetaContext = useContext(PageMetaContext)
  const canonicalHref = pageMetaContext?.canonicalHref
  const setPageMeta = pageMetaContext?.setPageMeta

  useEffect(() => {
    if (!setPageMeta || !canonicalHref) return
    setPageMeta({ pageKey, title, icon, iconKey, canonicalHref })
    // React node identity is intentionally excluded. Dynamic icons publish a
    // stable iconKey; otherwise pageKey + title + canonicalHref are enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPageMeta, pageKey, title, iconKey, canonicalHref])

  return <>{children}</>
}
