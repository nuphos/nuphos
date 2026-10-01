import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import clsx from 'clsx'

import type { ReactNode } from 'react'

type Side = NonNullable<TooltipPrimitive.Positioner.Props['side']>

function popupOrigin(side: Side) {
  if (side === 'top') return 'bottom center'
  if (side === 'left' || side === 'inline-start') return 'right center'
  if (side === 'right' || side === 'inline-end') return 'left center'

  return 'top center'
}

/**
 * Hover explanation for a control or label that cannot say enough on its own.
 *
 * Built on Base UI `Tooltip` rather than the native `title` attribute: the
 * platform tooltip takes a second or more to appear, renders in the OS style,
 * and is invisible to anyone reading with the keyboard.
 *
 * Styling follows `menu.tsx`: the popup must carry the `t-dropdown` /
 * `is-open` / `is-closing` classes wired to Base UI's transition state, or it
 * paints mid-transition — a box larger than its own clipped text.
 *
 * Keep the content to a sentence. Anything the reader has to act on belongs in
 * visible text; a tooltip is for detail that would otherwise crowd the row.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  /** The element to hover. Rendered as the trigger, so it must accept a ref. */
  children: ReactNode
  side?: Side
}) {
  return (
    // The delay lives on Provider, not Root. One per tooltip is intentional:
    // these sit in table rows, and a shared group delay would make the second
    // hover appear instantly while sweeping the cursor down a column.
    <TooltipPrimitive.Provider delay={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger render={<span className="inline-flex" />}>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-[1000]">
            <TooltipPrimitive.Popup
              className={(state) =>
                clsx(
                  't-dropdown max-w-[280px] rounded-lg border border-zGray-800/60 bg-main px-2.5 py-1.5',
                  'text-[11.5px] leading-snug text-secondary shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                  state.open && 'is-open',
                  state.transitionStatus === 'ending' && 'is-closing',
                )
              }
              style={(state) => ({ transformOrigin: popupOrigin(state.side) })}
            >
              {content}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
