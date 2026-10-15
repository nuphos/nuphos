import { api } from '../api.ts'
import { toast } from '../components/ui/toast.ts'

import { announceChatUnarchived } from './chatArchiveEvents.ts'

const plural = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? '' : 's'}`

async function restore(sessionIds: string[], teamId: string): Promise<void> {
  const results = await Promise.allSettled(
    sessionIds.map((id) =>
      api.agentSetConversationArchived(id, false, teamId).then(() => announceChatUnarchived(id)),
    ),
  )

  if (results.some((result) => result.status === 'rejected'))
    toast.error('Could not restore every chat')
}

/**
 * Archives a chat, then the threads chosen with it, only if the chat itself
 * archived. One receipt covers the whole action, and its Undo restores all of it.
 * `archiveOne` resolves whether that chat was archived.
 */
export async function archiveWithThreads({
  sessionId,
  threadIds,
  title,
  teamId,
  archiveOne,
}: {
  sessionId: string
  threadIds: string[]
  title: string
  teamId: string
  archiveOne: (sessionId: string) => Promise<boolean>
}): Promise<boolean> {
  if (!(await archiveOne(sessionId))) {
    toast.error('Could not archive chat')

    return false
  }
  const done = await Promise.all(threadIds.map(async (id) => ((await archiveOne(id)) ? id : null)))
  const archived = done.filter((id): id is string => id !== null)
  const failed = threadIds.length - archived.length

  toast.success(
    archived.length > 0
      ? `Chat and ${plural(archived.length, 'thread')} archived`
      : 'Chat archived',
    failed > 0
      ? `${String(failed)} of ${plural(threadIds.length, 'thread')} could not be archived.`
      : `"${title}" is still available in the Agent history.`,
    {
      action: {
        label: 'Undo',
        onClick: () => void restore([sessionId, ...archived], teamId),
      },
    },
  )

  return true
}
