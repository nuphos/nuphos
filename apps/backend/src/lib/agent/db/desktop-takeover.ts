import { agentConversations } from './shared'

/**
 * Someone took over a display of the conversation: an open `computer` request for it
 * starts counting how long they hold it, from the first time only.
 */
export async function markDesktopTakenOver(
  sessionId: string,
  display: number,
  at = new Date(),
): Promise<void> {
  const open = { 'r.category': 'computer', 'r.desktop.display': display, 'r.takenOverAt': null }

  await agentConversations().updateOne(
    { sessionId },
    { $set: { 'inputRequests.$[r].takenOverAt': at } },
    { arrayFilters: [open] },
  )
}
