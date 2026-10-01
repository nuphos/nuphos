import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import * as React from 'react'

type MenuCheckboxItemProps = {
  children: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/** A multi-select row: stays open on click and shows a check when ticked. */
export const MenuCheckboxItem = React.forwardRef<HTMLDivElement, MenuCheckboxItemProps>(
  function MenuCheckboxItem({ children, checked, onCheckedChange, disabled, className }, ref) {
    return (
      <MenuPrimitive.CheckboxItem
        ref={ref}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        closeOnClick={false}
        className={(state) =>
          clsx(
            'flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-main outline-none transition-colors',
            state.highlighted && 'bg-zGray-800/80',
            state.disabled && 'pointer-events-none opacity-50',
            className,
          )
        }
      >
        <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-main">
          <MenuPrimitive.CheckboxItemIndicator>
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
          </MenuPrimitive.CheckboxItemIndicator>
        </span>
        <span className="min-w-0 flex-1 text-left">{children}</span>
      </MenuPrimitive.CheckboxItem>
    )
  },
)

type MenuSubmenuTriggerProps = {
  children: React.ReactNode
  icon?: React.ReactNode
  /** Trailing chevron node; defaults to none so callers control the glyph. */
  chevron?: React.ReactNode
  disabled?: boolean
  title?: string
  className?: string
  /** Optional click handler on the trigger itself (the submenu still opens on
   *  hover). Call preventDefault to suppress the click-to-open toggle. */
  onClick?: (event: React.MouseEvent) => void
}

export const MenuSubmenuTrigger = React.forwardRef<HTMLDivElement, MenuSubmenuTriggerProps>(
  function MenuSubmenuTrigger(
    { children, icon, chevron, disabled, title, className, onClick },
    ref,
  ) {
    return (
      <MenuPrimitive.SubmenuTrigger
        ref={ref}
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={(state) =>
          clsx(
            'flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-main outline-none transition-colors',
            (state.highlighted || state.open) && 'bg-zGray-800/80',
            state.disabled && 'pointer-events-none opacity-50',
            className,
          )
        }
      >
        {icon != null && (
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-tertiary">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 text-left">{children}</span>
        {chevron != null && <span className="flex-shrink-0 text-tertiary">{chevron}</span>}
      </MenuPrimitive.SubmenuTrigger>
    )
  },
)

export function MenuSeparator({ className }: { className?: string }) {
  return <MenuPrimitive.Separator className={clsx('my-1 h-px bg-zGray-800/60', className)} />
}

export function MenuGroupLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <MenuPrimitive.GroupLabel
      className={clsx(
        'px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-tertiary',
        className,
      )}
    >
      {children}
    </MenuPrimitive.GroupLabel>
  )
}
