import { Select as SelectPrimitive } from '@base-ui/react/select'
import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'

import type { ReactNode } from 'react'

export type AppSelectOption = {
  value: string
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

type AppSelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: AppSelectOption[]
  placeholder?: ReactNode
  disabled?: boolean
  autoFocus?: boolean
  id?: string
  ariaLabel?: string
  className?: string
  triggerClassName?: string
  positionerClassName?: string
  contentClassName?: string
  itemClassName?: string
  onOpenChange?: (open: boolean) => void
}

function popupOrigin(
  side: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start' | 'none',
) {
  if (side === 'top') return 'bottom left'
  if (side === 'left') return 'right top'
  if (side === 'right' || side === 'inline-end') return 'left top'

  return 'top left'
}

export function AppSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select',
  disabled,
  autoFocus,
  id,
  ariaLabel,
  className,
  triggerClassName,
  positionerClassName,
  contentClassName,
  itemClassName,
  onOpenChange,
}: AppSelectProps) {
  const selected = options.find((option) => option.value === value)

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue ?? '')}
      disabled={disabled}
      onOpenChange={onOpenChange}
    >
      <div className={clsx('relative', className)}>
        <SelectPrimitive.Trigger
          id={id}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          className={clsx(
            'inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-zGray-700 bg-field px-2.5 text-left text-[13px] text-main outline-none transition-colors hover:border-zGray-600 focus:border-zGray-500 disabled:cursor-not-allowed disabled:opacity-50',
            triggerClassName,
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder}>
            {() => (
              <span className={clsx('min-w-0 flex-1 truncate', !selected && 'text-tertiary')}>
                {selected?.label ?? placeholder}
              </span>
            )}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-tertiary">
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            sideOffset={6}
            align="start"
            alignItemWithTrigger={false}
            className={clsx('z-[1000]', positionerClassName)}
          >
            <SelectPrimitive.Popup
              className={(state) =>
                clsx(
                  't-dropdown max-h-72 min-w-[var(--anchor-width)] overflow-auto scrollbar-thin rounded-lg border border-zGray-800/60 bg-main p-0 shadow-[0_4px_6px_-5px_rgba(0,0,0,0.2)]',
                  state.open && 'is-open',
                  state.transitionStatus === 'ending' && 'is-closing',
                  contentClassName,
                )
              }
              style={(state) => ({ transformOrigin: popupOrigin(state.side) })}
            >
              <SelectPrimitive.List>
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={(state) =>
                      clsx(
                        'flex min-h-7 cursor-default select-none items-center gap-2 px-2 py-1.5 text-[13px] text-main outline-none transition-colors',
                        state.highlighted && 'bg-zGray-800/80',
                        state.disabled && 'pointer-events-none opacity-50',
                        itemClassName,
                      )
                    }
                  >
                    <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-main">
                      <SelectPrimitive.ItemIndicator>
                        <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                      </SelectPrimitive.ItemIndicator>
                    </span>
                    <span className="min-w-0 flex-1">
                      <SelectPrimitive.ItemText>
                        <span className="block truncate">{option.label}</span>
                      </SelectPrimitive.ItemText>
                      {option.description && (
                        <span className="block truncate text-[12px] text-tertiary">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </div>
    </SelectPrimitive.Root>
  )
}
