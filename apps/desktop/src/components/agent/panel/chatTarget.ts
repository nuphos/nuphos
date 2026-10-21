import type { JournalChatTarget } from '../JournalPanel'
import type { Part } from './parts'

export function toolAnchorIds(parts: Part[]): string[] {
  return [...new Set(parts.flatMap((part) => (part.type === 'tool' ? [part.toolCallId] : [])))]
}

export function locateChatTarget(
  root: HTMLElement,
  target: JournalChatTarget,
  attempt = 0,
): boolean {
  if (!root.isConnected) return false
  const selector = target.toolCallId
    ? `[data-tool-call-id="${CSS.escape(target.toolCallId)}"]`
    : target.messageId
      ? `[data-message-id="${CSS.escape(target.messageId)}"]`
      : null

  if (!selector) return false
  const element = root.querySelector<HTMLElement>(selector)

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
