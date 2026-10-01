import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import * as React from 'react'

import { inputGroupControlClass } from './input-group'

const Combobox = ComboboxPrimitive.Root
const ComboboxValue = ComboboxPrimitive.Value
const ComboboxSeparator = ComboboxPrimitive.Separator

export { Combobox, ComboboxSeparator, ComboboxValue }

export const ComboboxTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Trigger> & {
    showIcon?: boolean
  }
>(function ComboboxTrigger({ className, children, showIcon = true, ...props }, ref) {
  return (
    <ComboboxPrimitive.Trigger
      ref={ref}
      className={(state) =>
        clsx(
          'inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-zGray-700 bg-field px-2.5 text-left text-[13px] text-main outline-none transition-colors hover:border-zGray-600 focus:border-zGray-500 disabled:cursor-not-allowed disabled:opacity-50',
          state.placeholder && 'text-tertiary',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {showIcon && (
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-tertiary" strokeWidth={2} />
      )}
    </ComboboxPrimitive.Trigger>
  )
})

export const ComboboxInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Input> & {
    endAdornment?: React.ReactNode
    inputClassName?: string
    showTrigger?: boolean
    variant?: 'default' | 'ghost'
  }
>(function ComboboxInput(
  {
    className,
    endAdornment,
    inputClassName,
    showTrigger = true,
    variant = 'default',
    disabled = false,
    ...props
  },
  ref,
) {
  const hasExplicitHeight = typeof className === 'string' && /\bh-/.test(className)

  return (
    <div
      className={clsx(
        'flex w-full min-w-0 items-center rounded-md text-main transition-colors',
        !hasExplicitHeight && 'h-8',
        variant === 'ghost'
          ? 'border-0 bg-transparent shadow-none'
          : 'border border-zGray-800 bg-field focus-within:border-zGray-500',
        disabled && 'cursor-not-allowed opacity-50',
        typeof className === 'string' && className,
      )}
    >
      <ComboboxPrimitive.Input
        ref={ref}
        disabled={disabled}
        className={(state) =>
          clsx(
            'h-full min-w-0 flex-1 px-2 text-[13px] placeholder:text-tertiary disabled:cursor-not-allowed',
            inputGroupControlClass,
            typeof className === 'function' && className(state),
            inputClassName,
          )
        }
        {...props}
      />
      {endAdornment}
      {showTrigger && (
        <ComboboxPrimitive.Trigger
          disabled={disabled}
          className="flex h-full w-7 flex-shrink-0 items-center justify-center rounded-r-md text-tertiary outline-none transition-colors hover:bg-zGray-800/60 hover:text-main disabled:cursor-not-allowed"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
        </ComboboxPrimitive.Trigger>
      )}
    </div>
  )
})

type ComboboxContentProps = React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Popup> & {
  align?: React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Positioner>['align']
  sideOffset?: React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Positioner>['sideOffset']
  positionerClassName?: string
}

function popupOrigin(
  side: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start' | 'none',
) {
  if (side === 'top') return 'bottom left'
  if (side === 'left') return 'right top'
  if (side === 'right' || side === 'inline-end') return 'left top'

  return 'top left'
}

export const ComboboxContent = React.forwardRef<HTMLDivElement, ComboboxContentProps>(
  function ComboboxContent(
    { align = 'start', sideOffset = 6, positionerClassName, className, style, children, ...props },
    ref,
  ) {
    return (
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align={align}
          sideOffset={sideOffset}
          className={clsx('z-[1000]', positionerClassName)}
        >
          <ComboboxPrimitive.Popup
            ref={ref}
            className={(state) =>
              clsx(
                'titlebar-no-drag t-dropdown max-h-72 min-w-[var(--anchor-width)] overflow-hidden rounded-lg border border-zGray-800/60 bg-main p-0 shadow-[0_4px_6px_-5px_rgba(0,0,0,0.2)]',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
                typeof className === 'function' ? className(state) : className,
              )
            }
            style={(state) => ({
              transformOrigin: popupOrigin(state.side),
              ...(typeof style === 'function' ? style(state) : style),
            })}
            {...props}
          >
            {children}
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    )
  },
)

export const ComboboxEmpty = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Empty>
>(function ComboboxEmpty({ className, ...props }, ref) {
  return (
    <ComboboxPrimitive.Empty
      ref={ref}
      className={(state) =>
        clsx(
          'px-2 py-2 text-[12.5px] text-tertiary',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    />
  )
})

export const ComboboxList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.List>
>(function ComboboxList({ className, ...props }, ref) {
  return (
    <ComboboxPrimitive.List
      ref={ref}
      className={(state) =>
        clsx(
          'm-0 max-h-56 overflow-auto scrollbar-thin p-0',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    />
  )
})

export const ComboboxItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Item>
>(function ComboboxItem({ className, children, ...props }, ref) {
  return (
    <ComboboxPrimitive.Item
      ref={ref}
      className={(state) =>
        clsx(
          'flex min-h-7 cursor-default select-none items-center gap-2 px-2 py-1.5 text-[13px] text-main outline-none transition-colors',
          state.highlighted && 'bg-zGray-800/80',
          state.disabled && 'pointer-events-none opacity-50',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    >
      <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-main">
        <ComboboxPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
        </ComboboxPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </ComboboxPrimitive.Item>
  )
})
