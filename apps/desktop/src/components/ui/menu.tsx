import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import * as React from 'react'

import { useSuspendTitlebarDrag } from '../../hooks/useSuspendTitlebarDrag'

// Base UI doesn't publicly export Side/Align, so derive them from Positioner props.
type Side = NonNullable<MenuPrimitive.Positioner.Props['side']>
type Align = NonNullable<MenuPrimitive.Positioner.Props['align']>

/**
 * Shared dropdown-menu primitives built on Base UI `Menu`. Every hand-rolled
 * dropdown in the app (sidebar menus, toolbar breadcrumbs, agent menus, the
 * right-click `ContextMenu`) should compose these instead of re-implementing
 * open/close state, outside-click dismissal, positioning, and animation.
 *
 * Styling mirrors `select.tsx` / `combobox.tsx`: the popup reuses the
 * `t-dropdown` / `is-open` / `is-closing` transition classes (wired to Base
 * UI's `state.open` / `state.transitionStatus`) and the `bg-main` surface so
 * all dropdowns share one look.
 */

const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger
const MenuGroup = MenuPrimitive.Group
const MenuSubmenu = MenuPrimitive.SubmenuRoot

export { Menu, MenuGroup, MenuSubmenu, MenuTrigger }

type AnchorProp = MenuPrimitive.Positioner.Props['anchor']

/**
 * Renders nothing; lives inside `Menu.Portal`, which returns null while the
 * menu is closed, so its lifetime is exactly the popup's. (The `MenuContent`
 * wrapper itself stays mounted alongside its trigger, so the effect can't hang
 * off that or dragging would be disabled for good.)
 *
 * Without this a press on the breadcrumb bar or the empty tab strip becomes a
 * window drag and the menu never sees the outside-press that should dismiss it.
 */
function TitlebarDragSuspender() {
  useSuspendTitlebarDrag(true)

  return null
}

function popupOrigin(side: Side) {
  if (side === 'top') return 'bottom center'
  if (side === 'left' || side === 'inline-start') return 'right top'
  if (side === 'right' || side === 'inline-end') return 'left top'

  return 'top center'
}

type MenuContentProps = {
  children: React.ReactNode
  side?: Side
  align?: Align
  sideOffset?: number
  alignOffset?: number
  anchor?: AnchorProp
  className?: string
  positionerClassName?: string
  /** Forwarded to the popup for things like `finalFocus`. */
  finalFocus?: MenuPrimitive.Popup.Props['finalFocus']
}

/**
 * Portal + Positioner + Popup in one. Defaults match the existing dropdowns:
 * 6px offset, start-aligned, `z-[1000]`, rounded surface with a soft shadow.
 */
export const MenuContent = React.forwardRef<HTMLDivElement, MenuContentProps>(function MenuContent(
  {
    children,
    side,
    align = 'start',
    sideOffset = 6,
    alignOffset,
    anchor,
    className,
    positionerClassName,
    finalFocus,
  },
  ref,
) {
  return (
    <MenuPrimitive.Portal>
      <TitlebarDragSuspender />
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        className={clsx('z-[1000]', positionerClassName)}
      >
        <MenuPrimitive.Popup
          ref={ref}
          finalFocus={finalFocus}
          className={(state) =>
            clsx(
              't-dropdown min-w-[180px] max-h-[var(--available-height)] overflow-auto scrollbar-thin rounded-lg border border-zGray-800/60 bg-main p-1 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
              state.open && 'is-open',
              state.transitionStatus === 'ending' && 'is-closing',
              className,
            )
          }
          style={(state) => ({ transformOrigin: popupOrigin(state.side) })}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
})

type MenuItemProps = {
  children: React.ReactNode
  /** Leading icon node (e.g. a Font Awesome / Lucide element). */
  icon?: React.ReactNode
  /** Muted text pinned to the right edge (e.g. "soon", a shortcut). */
  hint?: React.ReactNode
  /** Renders a trailing check — for "pick one of a list" menus. */
  selected?: boolean
  destructive?: boolean
  disabled?: boolean
  /** Whether closing the menu on click is desired. @default true */
  closeOnClick?: boolean
  onClick?: (event: React.MouseEvent) => void
  title?: string
  className?: string
}

export const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  {
    children,
    icon,
    hint,
    selected,
    destructive,
    disabled,
    closeOnClick,
    onClick,
    title,
    className,
  },
  ref,
) {
  return (
    <MenuPrimitive.Item
      ref={ref}
      disabled={disabled}
      closeOnClick={closeOnClick}
      onClick={onClick}
      title={title}
      className={(state) =>
        clsx(
          'flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] outline-none transition-colors',
          destructive ? 'text-error' : 'text-main',
          state.highlighted && (destructive ? 'bg-error/10' : 'bg-zGray-800/80'),
          state.disabled && 'pointer-events-none opacity-50',
          className,
        )
      }
    >
      {icon != null && (
        <span
          className={clsx(
            'flex h-4 w-4 flex-shrink-0 items-center justify-center',
            destructive ? 'text-error' : 'text-tertiary',
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">{children}</span>
      {hint != null && (
        <span className="flex-shrink-0 text-[11px] uppercase tracking-wider text-tertiary">
          {hint}
        </span>
      )}
      {selected && <Check className="h-3.5 w-3.5 flex-shrink-0 text-main" strokeWidth={2.4} />}
    </MenuPrimitive.Item>
  )
})

export { MenuCheckboxItem, MenuGroupLabel, MenuSeparator, MenuSubmenuTrigger } from './menu-extras'
