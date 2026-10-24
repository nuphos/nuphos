import { MoreHorizontal, X } from 'lucide-react'
import { useRef } from 'react'

import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { ShortcutHint } from '../../components/ui/shortcut-hint'
import { Tooltip } from '../../components/ui/tooltip'

/**
 * The ⋯ menu for a split pane that has no saved session (home, New agent, an
 * unsaved draft). Saved sessions get `SessionHeaderMenu`, which also holds Close pane.
 */
export function PaneMenu({ onClosePane }: { onClosePane: () => void }) {
  // Wait for the popup to finish closing: it hands focus back to its trigger in
  // this pane, which would make the closed pane the active one again.
  const closeOnClose = useRef(false)

  return (
    <Menu
      onOpenChangeComplete={(open) => {
        if (open || !closeOnClose.current) return
        closeOnClose.current = false
        onClosePane()
      }}
    >
      <Tooltip content="More actions" side="bottom">
        <MenuTrigger
          aria-label="More pane actions"
          className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main motion-reduce:transition-none"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="end" className="w-max min-w-[200px]">
        <MenuItem
          icon={<X className="h-3.5 w-3.5" />}
          hint={<ShortcutHint combo="mod+w" className="pl-4" />}
          onClick={() => {
            closeOnClose.current = true
          }}
        >
          Close pane
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
