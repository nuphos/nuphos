import { matchInputRequest } from './replyTarget.ts'

import type { JournalChatTarget } from '../JournalPanel'
import type { Part } from './parts'

export function toolAnchorIds(parts: Part[]): string[] {
  return [...new Set(parts.flatMap((part) => (part.type === 'tool' ? [part.toolCallId] : [])))]
}

function cardOf(element: HTMLElement) {
  const options = element.getAttribute('data-decision-options')

  return {
    toolCallId: element.getAttribute('data-tool-call-id') ?? '',
    question: element.getAttribute('data-decision-question') ?? undefined,
    options: options ? (JSON.parse(options) as string[]) : undefined,
  }
}

function findChatTarget(root: HTMLElement, target: JournalChatTarget): HTMLElement | null {
  const byId = target.toolCallId
    ? root.querySelector<HTMLElement>(`[data-tool-call-id="${CSS.escape(target.toolCallId)}"]`)
    : null

  if (byId) return byId
  // A native runtime's transcript keeps its own call id for a question Nuphos recorded under
  // another: the card is the first one an answer would map to this request.
  if (target.toolCallId && target.question !== undefined) {
    const request = { id: target.toolCallId, question: target.question, options: target.options }

    for (const card of root.querySelectorAll<HTMLElement>('[data-decision-question]')) {
      if (matchInputRequest(cardOf(card), [request])) return card
    }
  }

  return target.messageId && !target.toolCallId
    ? root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target.messageId)}"]`)
    : null
}

export function locateChatTarget(
  root: HTMLElement,
  target: JournalChatTarget,
  attempt = 0,
): boolean {
  if (!root.isConnected) return false
  const element = findChatTarget(root, target)

  if (!element) return false
  const toggle = element
    .closest('[data-chat-fold]')
    ?.querySelector<HTMLButtonElement>('[data-chat-fold-toggle]')

  if (
    element.hasAttribute('data-chat-fold-anchor') ||
    toggle?.getAttribute('aria-expanded') === 'false'
  ) {
    if (toggle && attempt < 3) {
      toggle.click()
      requestAnimationFrame(() => locateChatTarget(root, target, attempt + 1))
    }

    return false
  }
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const flashClasses = ['ring-2', 'ring-violet-400/70', 'rounded-lg']

  element.classList.add(...flashClasses)
  window.setTimeout(() => element.classList.remove(...flashClasses), 1600)

  return true
}
