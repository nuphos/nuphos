// What Esc and the arrow keys bring back into an empty composer: the message
// you just sent or queued, or the ones you sent before.
import { dispatchedDraft, waitingMessages } from './queuedAutoSend.ts'

import type { Message, QueuedMessage, Tab } from './model.ts'
import type { SendDraft } from './queuedAutoSend.ts'

/** Anything the agent said or did; bookkeeping parts are not an answer. */
function isOutput(part: Message['parts'][number]): boolean {
  const { type } = part as { type: string; text?: string }

  if (type === 'text' || type === 'reasoning')
    return Boolean((part as { text?: string }).text?.trim())

  return (
    type === 'file' ||
    type === 'dynamic-tool' ||
    type === 'data-steering' ||
    type.startsWith('tool-')
  )
}

export type ComposerRecall = {
  /** What Esc put back, once taken back; null when there is nothing to take back. */
  retract: () => Promise<{ text: string; filePaths: string[] } | null> | null
  /** Your sent messages, oldest first. */
  history: string[]
}

export type RetractTarget =
  { kind: 'queued'; item: QueuedMessage } | { kind: 'turn'; draft: SendDraft }

/**
 * What Esc takes back, newest first: your message waiting in the session queue
 * (a steer already on its way is not), else the message whose turn is running
 * with no output yet. Both are only ever this person's own sends.
 */
export function retractTarget(
  tab: Pick<Tab, 'queued' | 'streaming' | 'streamId' | 'messages' | 'unsaved'>,
): RetractTarget | null {
  const item = waitingMessages(tab).findLast((queued) => !queued.steering)

  if (item) return { kind: 'queued', item }
  if (!tab.streaming || !tab.streamId || tab.unsaved) return null
  const draft = dispatchedDraft(tab.streamId)
  const index = tab.messages.findIndex((message) => message.id === draft?.id)

  if (!draft || index < 0 || draft.turnKind === 'plan-approval') return null
  const after = tab.messages.slice(index + 1)

  return after.some((message) => message.role === 'user' || message.parts.some(isOutput))
    ? null
    : { kind: 'turn', draft }
}

/** Drop a taken-back message and the empty turn after it. */
export function withoutRetracted<T extends Pick<Tab, 'messages'>>(tab: T, messageId: string): T {
  const index = tab.messages.findIndex((message) => message.id === messageId)

  return index < 0 ? tab : { ...tab, messages: tab.messages.slice(0, index) }
}

/** Your own typed messages in this conversation, oldest first. */
export function sentHistory(
  messages: Pick<Message, 'role' | 'parts' | 'metadata' | 'turnKind'>[],
  currentUserId: string | undefined,
  foreignChat: boolean,
): string[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' || message.turnKind === 'plan-approval') return []
    const senderId = message.metadata?.sender.id

    if (senderId ? senderId !== currentUserId : foreignChat) return []
    const text = message.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()

    return text ? [text] : []
  })
}

/** Where you are in the history: `index` null while not browsing. */
export type HistoryCursor = { index: number | null; draft: string }

export const IDLE_CURSOR: HistoryCursor = { index: null, draft: '' }

/**
 * One arrow press. Up goes to the previous message, Down to the next, and Down
 * past the newest gives back the draft you had before browsing. Null when the
 * key has nowhere to go and should keep its ordinary caret movement.
 */
export function historyStep(
  cursor: HistoryCursor,
  direction: 'up' | 'down',
  history: string[],
  currentText: string,
): { cursor: HistoryCursor; text: string } | null {
  if (direction === 'up') {
    const index = (cursor.index ?? history.length) - 1

    if (index < 0) return null
    const draft = cursor.index === null ? currentText : cursor.draft

    return { cursor: { index, draft }, text: history[index]! }
  }
  if (cursor.index === null) return null
  const index = cursor.index + 1

  return index < history.length
    ? { cursor: { index, draft: cursor.draft }, text: history[index]! }
    : { cursor: IDLE_CURSOR, text: cursor.draft }
}

/**
 * The recall a key asks for. Never while an IME composes (its Esc cancels the
 * composition, its arrows pick candidates) or with a modifier held. An open
 * @mention picker sees the key first and keeps it.
 */
export function recallKey(event: {
  key: string
  composing: boolean
  modified: boolean
}): 'retract' | 'up' | 'down' | null {
  if (event.composing || event.modified) return null
  if (event.key === 'Escape') return 'retract'
  if (event.key === 'ArrowUp') return 'up'
  if (event.key === 'ArrowDown') return 'down'

  return null
}

/** Arrows browse history only from the edge line they point past. */
export function caretAtEdge(textBefore: string, textAfter: string, direction: 'up' | 'down') {
  return direction === 'up' ? !textBefore.includes('\n') : !textAfter.includes('\n')
}
