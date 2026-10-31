import { Archive, Bell, BellOff, Hash, Link2, Pencil, Star, StarOff, Unlink } from 'lucide-react'

import { api } from '../../api'
import { t } from '../../i18n'
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
  // A channel's row: its own nouns, and no pin or watch, which are an agent's.
  const channel = menu.item.channel === true

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      items={[
        ...(!channel && canFavorite(menu.item)
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
                label: t('Copy link'),
                icon: Link2,
                onSelect: () =>
                  copy(
                    agentSessionUrl(teamId, menu.item.key.slice('agent-session:'.length)),
                    'Link',
                  ),
              },
              {
                key: 'copy-session-id',
                label: channel ? t('Copy channel ID') : t('Copy agent ID'),
                icon: Hash,
                onSelect: () =>
                  copy(
                    menu.item.key.slice('agent-session:'.length),
                    channel ? 'Channel ID' : 'Agent ID',
                  ),
              },
              {
                key: 'rename',
                label: channel ? t('Rename channel') : t('Rename agent'),
                icon: Pencil,
                onSelect: () =>
                  renameChat(menu.item.key.slice('agent-session:'.length), menu.item.label),
              },
              ...(menu.item.parentKey
                ? [
                    {
                      key: 'unlink',
                      label: t('Unlink from parent'),
                      icon: Unlink,
                      onSelect: () => unlinkChat(menu.item.key.slice('agent-session:'.length)),
                    },
                  ]
                : []),
            ]
          : []),
        ...(!channel &&
        menu.item.key.startsWith('agent-session:') &&
        menu.item.watching !== undefined
          ? [
              {
                key: 'watch',
                label: menu.item.watching ? t('Unwatch agent') : t('Watch agent'),
                icon: menu.item.watching ? BellOff : Bell,
                onSelect: () => watchChat(menu.item, teamId),
              },
            ]
          : []),
        ...(menu.item.key.startsWith('agent-session:')
          ? [
              {
                key: 'archive',
                label: channel ? t('Archive channel') : t('Archive agent'),
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
      toast.apiError(watching ? t('Could not watch agent') : t('Could not unwatch agent'), err)
    })
}

const COPIED = {
  Link: () => t('Link copied'),
  'Agent ID': () => t('Agent ID copied'),
  'Channel ID': () => t('Channel ID copied'),
}

function copy(value: string, what: keyof typeof COPIED) {
  void copyLinkWithFeedback(value, (text) => navigator.clipboard.writeText(text), {
    onSuccess: () =>
      toast.success(COPIED[what](), undefined, {
        timeoutMs: 1200,
        dedupe: false,
      }),
    onError: () =>
      toast.error(
        what === 'Link'
          ? t('Could not copy link')
          : what === 'Channel ID'
            ? t('Could not copy channel ID')
            : t('Could not copy agent ID'),
        t('Clipboard was blocked.'),
      ),
  })
}
