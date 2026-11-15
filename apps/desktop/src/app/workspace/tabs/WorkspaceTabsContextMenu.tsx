import { Copy, Link, Plus, SquareArrowOutUpRight, Star, StarOff, X } from 'lucide-react'

import { ContextMenu } from '../../../components/ContextMenu'
import { Kbd } from '../../../components/ui/kbd'
import { toast } from '../../../components/ui/toast'
import { t } from '../../../i18n'

import type { TabContextMenuState } from './tabsTypes'

type WorkspaceTabsContextMenuProps = {
  menu: TabContextMenuState
  tabCount: number
  canFavorite: boolean
  favorited: boolean
  onNew: () => void
  onDuplicate: (id: string) => void
  onCopyPageUrl: (href: string) => void | Promise<void>
  /** Opens the tab in a window of its own; absent when only this window holds its page. */
  onOpenInWindow?: () => void
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
  onOpenInWindow,
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
          label: t('New tab'),
          icon: Plus,
          hint: <Kbd combo="mod+t" />,
          onSelect: onNew,
        },
        {
          key: 'duplicate-tab',
          label: t('Duplicate tab'),
          icon: Copy,
          onSelect: () => onDuplicate(menu.tabId),
        },
        {
          key: 'copy-url',
          label: t('Copy URL'),
          icon: Link,
          onSelect: () => onCopyPageUrl(menu.href),
        },
        {
          key: 'open-in-window',
          label: t('Open in new window'),
          icon: SquareArrowOutUpRight,
          disabled: !onOpenInWindow,
          onSelect: () => onOpenInWindow?.(),
        },
        ...(canFavorite
          ? [
              {
                key: 'favorite',
                // The menu closes on select, so unlike the in-tab star
                // (whose fill is the feedback) it confirms with a toast.
                label: favorited ? t('Remove from Favorites') : t('Add to Favorites'),
                icon: favorited ? StarOff : Star,
                onSelect: () => {
                  const added = toggleFavorite(menu.teamId, menu.appHref, menu.title)

                  if (added) toast.success(t('Added to Favorites'), menu.title)
                  else toast.success(t('Removed from Favorites'), menu.title)
                },
              },
            ]
          : []),
        { key: 'sep-1', separator: true },
        {
          key: 'close-tab',
          label: t('Close tab'),
          icon: X,
          hint: <Kbd combo="mod+w" />,
          onSelect: () => handleClose(menu.tabId),
        },
        {
          key: 'close-others',
          label: t('Close others'),
          icon: X,
          disabled: tabCount <= 1,
          onSelect: () => onCloseOthers(menu.tabId),
        },
      ]}
      onClose={onDismiss}
    />
  )
}
