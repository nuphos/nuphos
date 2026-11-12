import { api } from '../api.ts'
import { toast } from '../components/ui/toast.ts'
import { t } from '../i18n/index.ts'

import { announceChatUnarchived } from './chatArchiveEvents.ts'

type ArchivedChat = {
  sessionId: string
  teamId: string
  title: string
  /** What was archived, when the server said: a Bot (with its chat) or a chat on its own. */
  noun?: 'bot' | 'chat'
  /** Runs once the chat is back, before other surfaces hear about it. */
  onRestored?: () => void
}

/**
 * The receipt shown after archiving a chat: one stray click must be one click
 * to undo. Every archive gets its own toast, so archiving several chats in a
 * row leaves each one restorable.
 */
export function offerArchiveUndo({
  sessionId,
  teamId,
  title,
  noun,
  onRestored,
}: ArchivedChat): void {
  let restoring = false

  toast.success(
    noun === 'bot' ? t('Bot archived') : noun === 'chat' ? t('Chat archived') : t('Agent archived'),
    // A chat is not listed in Archived agents, so its receipt promises only Undo.
    noun === 'chat'
      ? undefined
      : noun === 'bot'
        ? t('"{title}" is still available in Archived agents.', { title })
        : t('"{title}" is still available in the Agent history.', { title }),
    {
      dedupe: false,
      action: {
        label: t('Undo'),
        onClick: () => {
          if (restoring) return
          restoring = true
          void api
            .agentSetConversationArchived(sessionId, false, teamId)
            .then(() => {
              onRestored?.()
              announceChatUnarchived(sessionId)
            })
            .catch((err: unknown) => {
              restoring = false
              toast.apiError(t('Could not restore agent'), err, {
                fallback: t('The agent is still archived. Try again from the Agent history.'),
              })
            })
        },
      },
    },
  )
}
