import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useMemo, useState } from 'react'

import { AppAlertDialog } from './ui/alert-dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator } from './ui/menu'

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type ContextMenuIcon = LucideIcon | IconDefinition

export type ContextMenuAction = {
  key: string
  label: string
  icon?: ContextMenuIcon
  // Optional confirmation prompt — if set, ask before running.
  confirm?: string
  destructive?: boolean
  disabled?: boolean
  // Optional sublabel rendered grey on the right (e.g. "soon", a <Kbd> shortcut).
  hint?: ReactNode
  onSelect: () => void | Promise<void>
}

export type ContextMenuSeparator = { key: string; separator: true }

// A non-interactive section heading that labels the group of items below it
// (e.g. "Cloud", "Document"). Rendered as an uppercase group label.
export type ContextMenuHeader = { key: string; header: true; label: string }

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator | ContextMenuHeader

type Props = {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * Cursor-anchored action menu. Public API ({ x, y, items, onClose }) is
 * unchanged so all call sites keep working; internally it now composes the
 * shared Base UI `Menu` with a virtual anchor at the cursor, which gives us
 * collision-aware positioning, outside-click / Escape dismissal, and keyboard
 * navigation for free.
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const [confirmAction, setConfirmAction] = useState<ContextMenuAction | null>(null)

  // A zero-size virtual element pinned at the cursor for Base UI to anchor to.
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        ({
          x,
          y,
          top: y,
          left: x,
          right: x,
          bottom: y,
          width: 0,
          height: 0,
          toJSON() {},
        }) as DOMRect,
    }),
    [x, y],
  )

  function pick(action: ContextMenuAction) {
    if (action.disabled) return
    if (action.confirm) {
      // Keep this component mounted and swap to the confirm dialog.
      setConfirmAction(action)

      return
    }
    void action.onSelect()
    // Base UI closes the menu (closeOnClick) → onOpenChange → onClose.
  }

  if (confirmAction) {
    return (
      <AppAlertDialog
        open
        title={confirmAction.label}
        description={confirmAction.confirm ?? ''}
        confirmLabel={confirmAction.destructive ? 'Delete' : 'Confirm'}
        destructive={confirmAction.destructive}
        onConfirm={confirmAction.onSelect}
        onClose={onClose}
      />
    )
  }

  return (
    <Menu
      open
      onOpenChange={(open, details) => {
        if (open) return
        // `open` is pinned true, so this menu only disappears when the parent
        // unmounts it via onClose. Close ONLY on an explicit dismissal —
        // picking an item, Escape, or a click/press outside. Every other
        // reason (focus-out when the pointer leaves the popup, etc.) is ignored
        // so the menu doesn't vanish the moment the cursor moves off it.
        const reason = details.reason

        if (
          reason === 'item-press' ||
          reason === 'close-press' ||
          reason === 'escape-key' ||
          reason === 'outside-press'
        ) {
          onClose()
        }
      }}
    >
      <MenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={4}
        // `!bg-elevated` overrides MenuContent's default `bg-main` so the
        // right-click menu sits on the lighter elevated surface.
        className="titlebar-no-drag min-w-[200px] py-1 text-[12.5px] !bg-elevated"
      >
        {items.map((item) => {
          if ('separator' in item) {
            return <MenuSeparator key={item.key} />
          }
          if ('header' in item) {
            // A plain, non-interactive label. Base UI's MenuGroupLabel needs a
            // <Menu.Group> parent context we don't set up in this flat list, so
            // render the same styling directly instead.
            return (
              <div
                key={item.key}
                className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-tertiary select-none"
              >
                {item.label}
              </div>
            )
          }
          const Icon = item.icon
          // A Font Awesome `IconDefinition` is a plain data object carrying an
          // `iconName`; a Lucide icon is a React component (a function, or a
          // `forwardRef` object — so `typeof === 'function'` misses it and would
          // render an empty span). Detect FA by its shape, treat everything else
          // as a renderable component.
          let icon: React.ReactNode = undefined

          if (Icon && typeof Icon === 'object' && 'iconName' in Icon) {
            icon = <FontAwesomeIcon icon={Icon} className="h-3.5 w-3.5" />
          } else if (Icon) {
            const LucideCmp = Icon as LucideIcon

            icon = <LucideCmp className="h-3.5 w-3.5" strokeWidth={1.8} />
          }

          return (
            <MenuItem
              key={item.key}
              icon={icon}
              hint={item.hint}
              destructive={item.destructive}
              disabled={item.disabled}
              closeOnClick={!item.confirm}
              onClick={() => pick(item)}
            >
              {item.label}
            </MenuItem>
          )
        })}
      </MenuContent>
    </Menu>
  )
}
