import { PreviewCard } from '@base-ui/react/preview-card'
import clsx from 'clsx'

import type { ReactNode } from 'react'

/** Shared GitHub preview for compact chat links and linked session resources. */
export function ResourcePreview({
  repository,
  identifier,
  title,
  state,
  review,
  loading,
  actionable = true,
  actions,
  children,
}: {
  repository: string
  identifier: string
  title?: string
  state?: string
  review?: string
  loading?: boolean
  actions?: ReactNode
  actionable?: boolean
  children: ReactNode
}) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={300}
        closeDelay={150}
        render={<span className="inline-flex min-w-0 max-w-full align-baseline" />}
      >
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={6} className="z-[1000]">
          <PreviewCard.Popup
            className={(popup) =>
              clsx(
                't-dropdown w-80 max-w-[calc(100vw-24px)] rounded-lg border border-zGray-800/60 bg-main p-3 text-main shadow-lg outline-none',
                popup.open && 'is-open',
                popup.transitionStatus === 'ending' && 'is-closing',
              )
            }
          >
            <div className="flex min-w-0 items-baseline gap-2 text-xs text-tertiary">
              <span className="min-w-0 break-all">{repository}</span>
              <span className="shrink-0 tabular-nums">{identifier}</span>
            </div>
            <div className="mt-1.5 break-words text-sm font-medium leading-snug">
              {title || (loading ? 'Loading details…' : 'GitHub details unavailable')}
            </div>
            {(state || review) && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
                {state && <span>{state}</span>}
                {review && <span>{review}</span>}
              </div>
            )}
            {(actionable || actions) && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-zGray-800/60 pt-2 text-[11px] text-tertiary">
                {actionable && <span>Open in browser tab</span>}
                {actions}
              </div>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
