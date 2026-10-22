import { Archive, Bell, BellOff, Hash, Link2, Pencil, Star, StarOff, Unlink } from 'lucide-react'

import { api } from '../../api'
import { copyLinkWithFeedback } from '../../lib/copyLink'
import { favoriteSessionId, favoriteToggleTitle } from '../../lib/sidebarPinnedChats'
import { agentSessionUrl } from '../agent/sessionUrl'
import { ContextMenu } from '../ContextMenu'
import { toast } from '../ui/toast'

import type { Item } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'

export function SidebarItemContextMenu({
  menu,
  teamId,
  onClose,
  canFavorite,
  favoriteMatch,
  toggleFavorite,
  archiveChat,
  unlinkChat,
  renameChat,
}: {
  menu: { x: number; y: number; item: Item }
  teamId: string
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
        ...(menu.item.key.startsWith('agent-session:')
          ? [
              {
                key: 'copy-link',
                label: 'Copy link',
                icon: Link2,
                onSelect: () =>
                  copy(
                    agentSessionUrl(teamId, menu.item.key.slice('agent-session:'.length)),
                    'Link',
                  ),
              },
              {
                key: 'copy-session-id',
                label: 'Copy agent ID',
                icon: Hash,
                onSelect: () => copy(menu.item.key.slice('agent-session:'.length), 'Agent ID'),
              },
              {
                key: 'rename',
                label: 'Rename agent',
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
        ...(menu.item.key.startsWith('agent-session:') && menu.item.watching !== undefined
          ? [
              {
                key: 'watch',
                label: menu.item.watching ? 'Unwatch agent' : 'Watch agent',
                icon: menu.item.watching ? BellOff : Bell,
                onSelect: () => watchChat(menu.item, teamId),
              },
            ]
          : []),
        ...(menu.item.key.startsWith('agent-session:')
          ? [
              {
                key: 'archive',
                label: 'Archive agent',
                icon: Archive,
                onSelect: () => archiveChat(menu.item.key.slice('agent-session:'.length)),
              },
            ]
          : []),
      ]}
    />
  )
}

// The sidebar's poll picks the new state up; nothing to refresh by hand.
function watchChat(item: Item, teamId: string) {
  const watching = !item.watching

  api
    .agentSetConversationWatched(item.key.slice('agent-session:'.length), watching, teamId)
    .catch((err: unknown) => {
      toast.apiError(watching ? 'Could not watch agent' : 'Could not unwatch agent', err)
    })
}

function copy(value: string, what: 'Link' | 'Agent ID') {
  void copyLinkWithFeedback(value, (text) => navigator.clipboard.writeText(text), {
    onSuccess: () => toast.success(`${what} copied`, undefined, { timeoutMs: 1200, dedupe: false }),
    onError: () => toast.error(`Could not copy ${what.toLowerCase()}`, 'Clipboard was blocked.'),
  })
}
