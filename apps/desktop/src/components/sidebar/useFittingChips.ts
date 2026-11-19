import { useLayoutEffect, useRef, useState } from 'react'

import { fittingChipCount, minimumRowWidth } from './sessionResourcePresentation'

type Fit = { shown: number; minimum: number; signature: string }

/**
 * Fits a row of chips to its width. `measureRef` holds an invisible copy of
 * every chip followed by the overflow chip, laid out at natural width; one
 * ResizeObserver on the row and the copy re-fits when either changes.
 * `minimum` is the narrowest the row can fold to; neither it nor the row's
 * width depends on how many chips show, so a fit never feeds back into itself.
 * `fresh` says the fit was measured for the chips as they are now.
 */
export function useFittingChips(keys: string[], unlinkable: boolean) {
  const count = keys.length
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Fit>({ shown: count, minimum: 0, signature: '' })
  // Refit before paint whenever the chips change, not just on the next resize;
  // unlink buttons widen titlebar chips without changing their keys.
  const signature = `${keys.join('\n')}\n${String(unlinkable)}`

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current

    if (!row || !measure) return

    const refit = () => {
      const style = getComputedStyle(row)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const gap = parseFloat(style.columnGap) || 0
      const widths = Array.from(measure.children, (child) => child.getBoundingClientRect().width)
      const overflowWidth = widths.pop() ?? 0
      const shown = fittingChipCount(widths, row.clientWidth - padding, gap, overflowWidth)
      const minimum = Math.ceil(minimumRowWidth(widths, overflowWidth) + padding)

      setFit((current) =>
        current.shown === shown && current.minimum === minimum && current.signature === signature
          ? current
          : { shown, minimum, signature },
      )
    }
    const observer = new ResizeObserver(refit)

    refit()
    observer.observe(row)
    observer.observe(measure)

    return () => observer.disconnect()
  }, [signature])

  return {
    rowRef,
    measureRef,
    shown: Math.min(fit.shown, count),
    minimum: fit.minimum,
    fresh: fit.signature === signature,
  }
}
