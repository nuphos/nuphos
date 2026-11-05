import { useState } from 'react'

import { splitPastedText } from '../../../lib/pastedText'

import { removePastedTextChip } from './composerPastedText'
import { PastedTextDialog } from './PastedTextDialog'

import type { MouseEvent } from 'react'

/** The composer's pasted-text chips: × takes one out, a click on the rest opens it. */
export function usePastedTextChips() {
  const [viewing, setViewing] = useState<string | null>(null)

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const chip = target.closest<HTMLElement>('[data-pasted-text]')

    if (!chip) return
    if (target.closest('[data-pasted-text-remove]')) {
      removePastedTextChip(chip)
      // The composer's own input handling updates the empty state and the draft.
      e.currentTarget.dispatchEvent(new Event('input', { bubbles: true }))
    } else setViewing(splitPastedText(chip.dataset.pastedText ?? '')[0].text)
  }

  return { onClick, dialog: <PastedTextDialog text={viewing} onClose={() => setViewing(null)} /> }
}
