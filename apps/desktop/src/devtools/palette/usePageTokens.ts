import { useCallback, useState } from 'react'

import { buildValueIndex, sampleElement } from './scan'

import type { RegistrySnapshot } from './types'

const MAX_ELEMENTS = 6000

export type PageScan = {
  tokens: string[] // token names present on the page, sorted
  scannedElements: number
  skippedAlpha: number // opacity-modified colors that couldn't be matched
}

// Detect which color tokens are actually rendered under #root. Manual (called
// on open + a "Rescan" button) since it walks the DOM and reads computed styles.
export function usePageTokens(registry: RegistrySnapshot) {
  const [scan, setScan] = useState<PageScan | null>(null)

  const rescan = useCallback(() => {
    const index = buildValueIndex(registry)
    const found = new Set<string>()
    let skipped = 0
    let count = 0

    const root = document.getElementById('root')

    if (root) {
      const els = root.querySelectorAll('*')

      for (const el of Array.from(els)) {
        if (count >= MAX_ELEMENTS) break
        // The panel/overlay live outside #root, but guard anyway.
        if ((el as HTMLElement).closest('[data-dev-palette]')) continue
        count++
        const sample = sampleElement(el, index)

        sample.tokens.forEach((n) => found.add(n))
        skipped += sample.skipped
      }
    }

    setScan({
      tokens: [...found].sort((a, b) => a.localeCompare(b)),
      scannedElements: count,
      skippedAlpha: skipped,
    })
  }, [registry])

  return { scan, rescan }
}
