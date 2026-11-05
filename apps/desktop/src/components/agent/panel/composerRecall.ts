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
  retract: () => Promise<RetractedDraft | null> | null
  /** Your sent messages, oldest first. */
  history: string[]
}

export type RetractedDraft = {
  text: string
  filePaths: string[]
  /**
   * Set when the composer gets the draft before the server has taken the
   * message back; resolves true if it could not, and the message stays sent.
   */
  undone?: Promise<boolean>
}

export type RetractTarget =
  { kind: 'queued'; item: QueuedMessage } | { kind: 'turn'; draft: SendDraft }

/**
 * What Esc takes back, newest first: your message waiting in the session queue
 * (a steer already on its way is not), else the message whose turn is running
 * with no output yet. Both are only ever this person's own sends.
 */
export function retractTarget(
  tab: Pick<Tab, 'queued' | 'streaming' | 'streamId' | 'messages' | 'unsaved' | 'retracting'>,
): RetractTarget | null {
  const item = waitingMessages(tab).findLast((queued) => !queued.steering)

  if (item) return { kind: 'queued', item }
  if (!tab.streaming || !tab.streamId || tab.unsaved || tab.retracting) return null
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

/** The tab as shown: a message being taken back is already gone. */
export function hidingRetracted<T extends Pick<Tab, 'messages' | 'retracting'>>(tab: T): T {
  return tab.retracting ? withoutRetracted(tab, tab.retracting) : tab
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

/**
 * Whether an arrow browses history rather than moving the caret. Up starts
 * browsing only from the very start of the draft, so moving up through a
 * multi-line draft (wrapped lines included) never swaps it out: the first Up
 * on the top line takes the caret to its start, the next one recalls. Once
 * browsing, either arrow steps from the edge line it points past.
 */
export function caretAtEdge(
  textBefore: string,
  textAfter: string,
  direction: 'up' | 'down',
  browsing: boolean,
) {
  if (direction === 'up') return browsing ? !textBefore.includes('\n') : textBefore === ''

  return !textAfter.includes('\n')
}
