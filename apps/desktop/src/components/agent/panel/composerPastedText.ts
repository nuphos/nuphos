import { t } from '../../../i18n'
import { svg } from '../../../lib/atlas-link-mention/icons'
import { encodePastedText, pastedTextLabel } from '../../../lib/pastedText'

/**
 * A long paste. The chip holds the block it sends, encoded once, so a copy or
 * an undo keeps it and a keystroke never re-reads the paste.
 */
export function pastedTextChip(text: string): HTMLElement {
  const chip = document.createElement('span')
  const label = document.createElement('span')
  const remove = document.createElement('span')

  chip.className = 'atlas-mention'
  chip.contentEditable = 'false'
  chip.dataset.pastedText = encodePastedText(text)
  chip.innerHTML = svg('file')
  label.className = 'atlas-mention-label'
  label.textContent = pastedTextLabel(text)
  remove.className = 'atlas-mention-remove'
  remove.dataset.pastedTextRemove = ''
  remove.role = 'button'
  remove.ariaLabel = t('Remove pasted text')
  remove.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  chip.append(label, remove)

  return chip
}

/** Take a pasted-text chip out with the space it was inserted with. */
export function removePastedTextChip(chip: HTMLElement) {
  const next = chip.nextSibling

  if (next?.nodeType === Node.TEXT_NODE)
    next.textContent = next.textContent?.replace(/^ /, '') ?? ''
  chip.remove()
}
