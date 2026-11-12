import {
  Archive,
  Bell,
  BellOff,
  Bot,
  Hash,
  Link2,
  Pencil,
  SmilePlus,
  Pin,
  PinOff,
  Star,
  StarOff,
  Unlink,
} from 'lucide-react'

import { api } from '../../api'
import { t } from '../../i18n'
import { openChangeBotAvatar } from '../../lib/changeBotAvatar'
import { copyLinkWithFeedback } from '../../lib/copyLink'
import { agentSessionUrl } from '../agent/sessionUrl'
import { makeBot } from '../channels/botChannel'
import { ContextMenu } from '../ContextMenu'
import { toast } from '../ui/toast'

import { canBecomeBot } from './make-bot'

import type { Item, ItemMenuRequest } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'

export function SidebarItemContextMenu({
  menu,
  teamId,
  onClose,
  canFavorite,
  favoriteMatch,
  toggleFavorite,
  archiveChat,
  confirmArchiveBot,
  unlinkChat,
  renameChat,
}: {
  menu: ItemMenuRequest
  teamId: string
  onClose: () => void
  canFavorite: (item: Item) => boolean
  favoriteMatch: (item: Item) => SidebarFavorite | undefined
  toggleFavorite: (item: Item) => void
  renameChat: (sessionId: string, title: string) => void
  archiveChat: (sessionId: string) => Promise<void>
  confirmArchiveBot: (sessionId: string) => void
  unlinkChat: (sessionId: string) => Promise<void>
}) {
  // A Bot's channel shares its pin controls with the Bot row.
  const channel = menu.item.channel === true
  // A Bot is a Bot in either section (its chat or itself); otherwise a Task or a group chat.
  const noun = menu.item.bot || menu.item.botChannelOf ? 'bot' : channel ? 'chat' : 'task'
  const sessionId = menu.item.key.slice('agent-session:'.length)

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      items={[
        ...((!channel || noun === 'bot') && canFavorite(menu.item)
          ? [
              favoriteMatch(menu.item)
                ? {
                    key: 'unfavorite',
                    label: noun === 'bot' ? t('Unpin Bot') : t('Remove from Favorites'),
                    icon: noun === 'bot' ? PinOff : StarOff,
                    onSelect: () => toggleFavorite(menu.item),
                  }
                : {
                    key: 'favorite',
                    label: noun === 'bot' ? t('Pin Bot') : t('Add to Favorites'),
                    icon: noun === 'bot' ? Pin : Star,
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
                label: COPY_ID[noun](),
                icon: Hash,
                onSelect: () => copy(sessionId, noun),
              },
              ...(menu.item.readOnlyChat
                ? []
                : [
                    {
                      key: 'rename',
                      label: RENAME[noun](),
                      icon: Pencil,
                      // A Bot's chat is named after the Bot, so its Rename names the Bot.
                      onSelect: () =>
                        renameChat(menu.item.botChannelOf ?? sessionId, menu.item.label),
                    },
                    // A Bot's chat wears the Bot's face, so its row changes the Bot's.
                    ...(noun === 'bot'
                      ? [
                          {
                            key: 'change-avatar',
                            label: t('Change avatar'),
                            icon: SmilePlus,
                            onSelect: () =>
                              openChangeBotAvatar({
                                teamId,
                                botId: menu.item.botChannelOf ?? sessionId,
                                title: menu.item.label,
                              }),
                          },
                        ]
                      : []),
                  ]),
              ...(menu.item.parentKey && !menu.item.readOnlyChat
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
                label: menu.item.watching
                  ? noun === 'bot'
                    ? t('Unwatch Bot')
                    : t('Unwatch task')
                  : noun === 'bot'
                    ? t('Watch Bot')
                    : t('Watch task'),
                icon: menu.item.watching ? BellOff : Bell,
                onSelect: () => watchChat(menu.item, teamId),
              },
            ]
          : []),
        // A Task becomes a Bot from its row too, as from its session's menu; a sub-task does not.
        ...(canBecomeBot(menu.item)
          ? [
              {
                key: 'make-bot',
                label: t('Make this a Bot'),
                icon: Bot,
                onSelect: () => void makeBot(teamId, sessionId),
              },
            ]
          : []),
        ...(menu.item.key.startsWith('agent-session:') &&
        (!menu.item.readOnlyChat || menu.item.managedChat)
          ? [
              {
                key: 'archive',
                label: ARCHIVE[noun](),
                icon: Archive,
                // A Bot goes with its chat; the server archives both. Its Task row
                // reads as a Task, so it asks first.
                onSelect: () =>
                  menu.item.task && menu.item.bot
                    ? confirmArchiveBot(sessionId)
                    : void archiveChat(sessionId),
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

const COPY_ID = {
  task: () => t('Copy task ID'),
  bot: () => t('Copy Bot ID'),
  chat: () => t('Copy chat ID'),
}
const RENAME = {
  task: () => t('Rename task'),
  bot: () => t('Rename Bot'),
  chat: () => t('Rename chat'),
}
const ARCHIVE = {
  task: () => t('Archive Task'),
  bot: () => t('Archive Bot'),
  chat: () => t('Archive chat'),
}
const COPIED = {
  Link: () => t('Link copied'),
  task: () => t('Task ID copied'),
  bot: () => t('Bot ID copied'),
  chat: () => t('Chat ID copied'),
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
          : what === 'chat'
            ? t('Could not copy chat ID')
            : what === 'bot'
              ? t('Could not copy Bot ID')
              : t('Could not copy task ID'),
        t('Clipboard was blocked.'),
      ),
  })
}
