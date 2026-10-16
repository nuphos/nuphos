import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import clsx from 'clsx'

import { comboParts } from '../../../lib/platform'

import type { ReactNode } from 'react'

/**
 * Codex desktop's tooltips (ChatGPT.app, webview/assets/app-shared-*.js `w5`,
 * `eMi`, `dxi`), at the 1.1 scale the rest of this control uses: they open
 * after 200 ms, a neighbour opens at once for 300 ms after one closes, and
 * they appear and leave without animation.
 */
export function ModelTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={200} closeDelay={0} timeout={300}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

/** A Codex-style hover label, optionally with its key combo. */
export function HintTooltip({
  label,
  combo,
  side = 'top',
  sideOffset = 2.2,
  description,
  disabled,
  children,
}: {
  label: ReactNode
  combo?: string
  side?: 'top' | 'right' | 'left' | 'bottom'
  sideOffset?: number
  /** A longer, left-aligned text, as beside Codex's model rows. */
  description?: boolean
  disabled?: boolean
  /** The hovered element; it must accept a ref. */
  children: ReactNode
}) {
  return (
    <TooltipPrimitive.Root disabled={disabled}>
      <TooltipPrimitive.Trigger render={<span className="flex min-w-0" />}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8.8}
          className="z-[1001]"
        >
          <TooltipPrimitive.Popup
            className={clsx(
              'flex w-fit items-center gap-[8.8px] rounded-[17.6px] border px-[13.2px] py-[5.5px] text-[13.2px] leading-[19.8px] tracking-[-0.165px] shadow-[0_8.8px_19.8px_#0f172a33]',
              'border-[rgba(var(--color-text-base),0.05)] bg-[color-mix(in_srgb,rgb(var(--color-background-base))_96%,rgb(var(--color-text-base)))] text-main',
              '[html.light_&]:border-[#f9f9f90d] [html.light_&]:bg-[#0d0d0d] [html.light_&]:text-[#f9f9f9]',
              description
                ? 'max-w-[281.6px] text-pretty text-left'
                : 'max-w-[min(352px,calc(100vw-16px))] text-center',
            )}
          >
            <span className="min-w-0">{label}</span>
            {combo && (
              <kbd className="-me-[7.7px] inline-flex h-[19.8px] min-w-[17.6px] items-center justify-center rounded-[8.8px] bg-[color-mix(in_srgb,currentColor_25%,transparent)] px-[6.6px] font-sans text-[13.2px] leading-[19.8px]">
                {comboParts(combo).join('')}
              </kbd>
            )}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
