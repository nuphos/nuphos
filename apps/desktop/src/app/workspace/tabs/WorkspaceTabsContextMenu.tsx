import { Copy, Link, Plus, Star, StarOff, X } from 'lucide-react'

import { ContextMenu } from '../../../components/ContextMenu'
import { Kbd } from '../../../components/ui/kbd'
import { toast } from '../../../components/ui/toast'

import type { TabContextMenuState } from './tabsTypes'

type WorkspaceTabsContextMenuProps = {
  menu: TabContextMenuState
  tabCount: number
  canFavorite: boolean
  favorited: boolean
  onNew: () => void
  onDuplicate: (id: string) => void
  onCopyPageUrl: (href: string) => void | Promise<void>
  toggleFavorite: (teamId: string, appHref: string, title: string) => boolean
  handleClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onDismiss: () => void
}

export function WorkspaceTabsContextMenu({
  menu,
  tabCount,
  canFavorite,
  favorited,
  onNew,
  onDuplicate,
  onCopyPageUrl,
  toggleFavorite,
  handleClose,
  onCloseOthers,
  onDismiss,
}: WorkspaceTabsContextMenuProps) {
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={[
        {
          key: 'new-tab',
          label: 'New tab',
          icon: Plus,
          hint: <Kbd combo="mod+t" />,
          onSelect: onNew,
        },
        {
          key: 'duplicate-tab',
          label: 'Duplicate tab',
          icon: Copy,
          onSelect: () => onDuplicate(menu.tabId),
        },
        {
          key: 'copy-url',
          label: 'Copy URL',
          icon: Link,
          onSelect: () => onCopyPageUrl(menu.href),
        },
        ...(canFavorite
          ? [
              {
                key: 'favorite',
                // The menu closes on select, so unlike the in-tab star
                // (whose fill is the feedback) it confirms with a toast.
                label: favorited ? 'Remove from Favorites' : 'Add to Favorites',
                icon: favorited ? StarOff : Star,
                onSelect: () => {
                  const added = toggleFavorite(menu.teamId, menu.appHref, menu.title)

                  if (added) toast.success('Added to Favorites', menu.title)
                  else toast.success('Removed from Favorites', menu.title)
                },
              },
            ]
          : []),
        { key: 'sep-1', separator: true },
        {
          key: 'close-tab',
          label: 'Close tab',
          icon: X,
          hint: <Kbd combo="mod+w" />,
          onSelect: () => handleClose(menu.tabId),
        },
        {
          key: 'close-others',
          label: 'Close others',
          icon: X,
          disabled: tabCount <= 1,
          onSelect: () => onCloseOthers(menu.tabId),
        },
      ]}
      onClose={onDismiss}
    />
  )
}
