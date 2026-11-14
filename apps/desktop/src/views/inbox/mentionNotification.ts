import { useEffect, useRef } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'

import { freshMentions } from './mentionNotice'

import type { ChannelMention } from '../../api'

/**
 * Tells the viewer, through a system notification, about each new @mention or invite: the
 * Inbox badge alone goes unseen while the window is in the background.
 */
export function useMentionNotifications(
  teamId: string,
  mentions: readonly ChannelMention[] | null,
) {
  const seen = useRef<{ teamId: string; ids: Set<string> } | null>(null)

  useEffect(() => {
    if (!mentions) return
    const known = seen.current?.teamId === teamId ? seen.current.ids : null

    for (const mention of freshMentions(known, mentions)) {
      const name = mention.sender?.name ?? t('Someone')

      void api
        .agentNotifyMention({
          messageId: mention.messageId,
          title: mention.invited
            ? t('{name} invited you to {title}', { name, title: mention.title })
            : t('{name} mentioned you in {title}', { name, title: mention.title }),
          body: mention.text,
          sessionId: mention.channelId,
          teamId,
        })
        .catch(() => {
          // Best effort: the Inbox still lists it.
        })
    }
    seen.current = {
      teamId,
      ids: new Set([...(known ?? []), ...mentions.map((mention) => mention.messageId)]),
    }
  }, [mentions, teamId])
}
