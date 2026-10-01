/* eslint-disable react-refresh/only-export-components -- the component and hook are one reporting primitive */
import { useEffect } from 'react'

import { trackError } from '../lib/analytics'

/**
 * Last-line coverage for failures that have already been converted into UI
 * state or persisted backend records. Reporting at render time is deliberate:
 * these errors may never have existed as a rejected promise in this process.
 */
export function useReportVisibleError(
  message: string | null | undefined,
  surface: string,
  active = true,
): void {
  useEffect(() => {
    if (!active || !message?.trim()) return
    trackError({
      source: 'visible_error',
      phase: surface,
      message,
      rendered: true,
    })
  }, [active, message, surface])
}

export function VisibleErrorReporter({
  message,
  surface,
  active = true,
}: {
  message: string | null | undefined
  surface: string
  active?: boolean
}) {
  useReportVisibleError(message, surface, active)

  return null
}
