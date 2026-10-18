import { Archive, Pencil, Star, StarOff, Unlink } from 'lucide-react'

import { favoriteSessionId, favoriteToggleTitle } from '../../lib/sidebarPinnedChats'
import { ContextMenu } from '../ContextMenu'

import type { Item } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'

export function SidebarItemContextMenu({
  menu,
  onClose,
  canFavorite,
  favoriteMatch,
  toggleFavorite,
  archiveChat,
  unlinkChat,
  renameChat,
}: {
  menu: { x: number; y: number; item: Item }
  onClose: () => void
  canFavorite: (item: Item) => boolean
  favoriteMatch: (item: Item) => SidebarFavorite | undefined
  toggleFavorite: (item: Item) => void
  renameChat: (sessionId: string, title: string) => void
  archiveChat: (sessionId: string) => Promise<void>
  unlinkChat: (sessionId: string) => Promise<void>
}) {
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      items={[
        ...(canFavorite(menu.item)
          ? [
              favoriteMatch(menu.item)
                ? {
                    key: 'unfavorite',
                    label: favoriteToggleTitle(favoriteSessionId(menu.item) !== null, true),
                    icon: StarOff,
                    onSelect: () => toggleFavorite(menu.item),
                  }
                : {
                    key: 'favorite',
                    label: favoriteToggleTitle(favoriteSessionId(menu.item) !== null, false),
                    icon: Star,
                    onSelect: () => toggleFavorite(menu.item),
                  },
            ]
          : []),
        ...(menu.item.key.startsWith('agent-session:') && !menu.item.readOnlyChat
          ? [
              {
                key: 'rename',
                label: 'Rename chat',
                icon: Pencil,
                onSelect: () =>
                  renameChat(menu.item.key.slice('agent-session:'.length), menu.item.label),
              },
              ...(menu.item.parentKey
                ? [
                    {
                      key: 'unlink',
                      label: 'Unlink from parent',
                      icon: Unlink,
                      onSelect: () => unlinkChat(menu.item.key.slice('agent-session:'.length)),
                    },
                  ]
                : []),
            ]
          : []),
        ...(menu.item.key.startsWith('agent-session:') &&
        (!menu.item.readOnlyChat || menu.item.managedChat)
          ? [
              {
                key: 'archive',
                label: 'Archive chat',
                icon: Archive,
                onSelect: () => archiveChat(menu.item.key.slice('agent-session:'.length)),
              },
            ]
          : []),
      ]}
    />
  )
}
