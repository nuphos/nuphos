import { useState } from 'react'

import { pastedTextLabel } from '../../../lib/pastedText'
import { Modal } from '../../Modal'

/** Read-only view of a pasted-text chip, from the composer or the transcript. */
export function PastedTextDialog({ text, onClose }: { text: string | null; onClose: () => void }) {
  // Keep the last text through the close animation.
  const [shown, setShown] = useState(text)

  if (text !== null && text !== shown) setShown(text)

  return (
    <Modal
      open={text !== null}
      onClose={onClose}
      title={shown === null ? '' : pastedTextLabel(shown)}
      width={720}
    >
      <pre className="max-h-[60vh] overflow-auto px-6 py-4 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-main">
        {shown}
      </pre>
    </Modal>
  )
}
