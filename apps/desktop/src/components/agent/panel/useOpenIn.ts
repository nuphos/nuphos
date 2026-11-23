import { useState } from 'react'

/** Open in the chat it was opened in, closed by a switch: the panel stays mounted across one. */
export function useOpenIn(sessionId: string | undefined): [boolean, (open: boolean) => void] {
  const [openIn, setOpenIn] = useState<string | undefined>()

  if (openIn !== undefined && openIn !== sessionId) setOpenIn(undefined)

  return [
    openIn !== undefined && openIn === sessionId,
    (open) => setOpenIn(open ? sessionId : undefined),
  ]
}
