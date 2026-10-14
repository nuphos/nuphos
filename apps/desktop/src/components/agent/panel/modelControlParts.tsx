import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import clsx from 'clsx'

import { comboParts } from '../../../lib/platform'

import { SURFACE } from './modelControlStyles'

import type { ReactNode } from 'react'

/** A Codex-style hover label, optionally with its key combo. */
export function HintTooltip({
  label,
  combo,
  side = 'top',
  sideOffset = 6,
  disabled,
  children,
}: {
  label: ReactNode
  combo?: string
  side?: 'top' | 'right' | 'left' | 'bottom'
  sideOffset?: number
  disabled?: boolean
  /** The hovered element; it must accept a ref. */
  children: ReactNode
}) {
  return (
    <TooltipPrimitive.Provider delay={300}>
      <TooltipPrimitive.Root disabled={disabled}>
        <TooltipPrimitive.Trigger render={<span className="flex min-w-0" />}>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} className="z-[1001]">
            <TooltipPrimitive.Popup
              className={clsx(
                SURFACE,
                'flex h-[30px] items-center gap-[10px] whitespace-nowrap rounded-[10px] text-[13.5px] text-main',
                combo ? 'pl-[10.5px] pr-[5px]' : 'px-[14px]',
              )}
            >
              {label}
              {combo && (
                <kbd className="flex h-[20px] items-center rounded-[6px] bg-[rgba(var(--color-text-base),0.22)] px-[6px] font-sans text-[13px] text-main">
                  {comboParts(combo).join('')}
                </kbd>
              )}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
