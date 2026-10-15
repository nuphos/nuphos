import {
  Archive,
  Folder,
  FolderMinus,
  FolderPlus,
  Pencil,
  Star,
  StarOff,
  Unlink,
} from 'lucide-react'

import { favoriteSessionId, favoriteToggleTitle } from '../../lib/sidebarPinnedChats'
import { ContextMenu } from '../ContextMenu'

import type { Item } from './types'
import type { SidebarProjectsController } from './use-sidebar-projects'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'
import type { ContextMenuItem } from '../ContextMenu'

/** No separator may open or close the menu, whatever optional groups it ends up with. */
function trimSeparators(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.filter(
    (item, index) => !('separator' in item) || (index > 0 && index < items.length - 1),
  )
}

/** "Move to project" entries: the other projects, a new one, and the way back to Chats. */
function projectMenuItems(
  sessionId: string,
  projects: SidebarProjectsController,
): ContextMenuItem[] {
  const current = projects.projectOf(sessionId)

  return [
    { key: 'projects-sep', separator: true },
    { key: 'projects-header', header: true, label: 'Move to project' },
    ...projects.list
      .filter((project) => project.id !== current?.id)
      .map((project) => ({
        key: `project-${project.id}`,
        label: project.name,
        icon: Folder,
        onSelect: () => projects.move(sessionId, project.id),
      })),
    {
      key: 'project-new',
      label: 'New project',
      icon: FolderPlus,
      onSelect: () => projects.create(sessionId),
    },
    ...(current
      ? [
          {
            key: 'project-remove',
            label: `Remove from ${current.name}`,
            icon: FolderMinus,
            onSelect: () => projects.move(sessionId, null),
          },
        ]
      : []),
    { key: 'projects-end', separator: true },
  ]
}

export function SidebarItemContextMenu({
  menu,
  onClose,
  canFavorite,
  favoriteMatch,
  toggleFavorite,
  archiveChat,
  unlinkChat,
  renameChat,
  projects,
}: {
  menu: { x: number; y: number; item: Item }
  onClose: () => void
  canFavorite: (item: Item) => boolean
  favoriteMatch: (item: Item) => SidebarFavorite | undefined
  toggleFavorite: (item: Item) => void
  renameChat: (sessionId: string, title: string) => void
  archiveChat: (sessionId: string) => void
  unlinkChat: (sessionId: string) => Promise<void>
  /** Present in team view; filing a chat is personal, so shared chats can be filed too. */
  projects?: SidebarProjectsController
}) {
  const sessionId = menu.item.key.startsWith('agent-session:')
    ? menu.item.key.slice('agent-session:'.length)
    : null

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      items={trimSeparators([
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
        ...(sessionId && projects ? projectMenuItems(sessionId, projects) : []),
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
      ])}
    />
  )
}
