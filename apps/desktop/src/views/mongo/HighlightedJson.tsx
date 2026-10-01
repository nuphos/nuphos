import { useEffect, useMemo, useState } from 'react'
import { createHighlighter } from 'shiki'

import { useResetOnKey } from '../useResetOnKey'

import type { Highlighter } from 'shiki'

let jsonHighlighterPromise: Promise<Highlighter> | null = null

function getJsonHighlighter(): Promise<Highlighter> {
  jsonHighlighterPromise ??= createHighlighter({ themes: ['night-owl'], langs: ['json'] })

  return jsonHighlighterPromise
}

export function HighlightedJson({ value }: { value: unknown }) {
  const code = useMemo(() => JSON.stringify(value, null, 2), [value])
  const [html, setHtml] = useState<string | null>(null)

  useResetOnKey(code, () => setHtml(null))
  useEffect(() => {
    let active = true

    void getJsonHighlighter().then((highlighter) => {
      if (active) setHtml(highlighter.codeToHtml(code, { lang: 'json', theme: 'night-owl' }))
    })

    return () => {
      active = false
    }
  }, [code])

  if (!html)
    return <pre className="m-0 font-mono text-[10.5px] leading-[17px] text-secondary">{code}</pre>

  return <div className="mongo-json-shiki" dangerouslySetInnerHTML={{ __html: html }} />
}
