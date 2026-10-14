import { useCallback, useRef, useState } from 'react'

import { api } from '../../api'
import {
  captureArea,
  commentModeScript,
  EXIT_COMMENT_MODE_SCRIPT,
  formatComment,
  parsePick,
} from '../../lib/browserAnnotate'

import type { PickedElement } from '../../lib/browserAnnotate'
import type { WebviewTag } from 'electron'
import type { RefObject } from 'react'

/**
 * Comment mode: click an element, write a note next to it, and the note lands
 * in the agent composer with a screenshot of the element. The mode stays on
 * for further comments until the user leaves it.
 */
export function useBrowserComments(
  viewRef: RefObject<WebviewTag | null>,
  onComment?: (text: string, filePaths: string[]) => void,
) {
  const [active, setActive] = useState(false)
  const [draft, setDraft] = useState<PickedElement | null>(null)
  // Bumped whenever comment mode ends, so a result from an earlier session
  // (or an earlier document) never lands in the current one.
  const session = useRef(0)
  const count = useRef(0)

  const reset = useCallback(() => {
    session.current += 1
    setActive(false)
    setDraft(null)
  }, [])

  const stop = () => {
    void viewRef.current?.executeJavaScript(EXIT_COMMENT_MODE_SCRIPT).catch(() => {})
    reset()
  }

  const arm = (pin?: number) => {
    const view = viewRef.current

    if (!view) return
    const current = session.current

    // Keyboard focus belongs in the page so Esc reaches comment mode.
    view.focus()
    view.executeJavaScript(commentModeScript(pin)).then(
      (raw: unknown) => {
        if (current !== session.current) return
        const picked = parsePick(raw)

        if (picked) setDraft(picked)
        else stop()
      },
      () => {
        if (current === session.current) reset()
      },
    )
  }

  const toggle = () => {
    if (active) {
      stop()

      return
    }
    session.current += 1
    setActive(true)
    arm()
  }

  const cancel = () => {
    setDraft(null)
    arm()
  }

  const save = async (note: string) => {
    const view = viewRef.current

    if (!view || !draft || !onComment) return
    const current = session.current
    const n = ++count.current
    const filePaths = await captureElement(view, draft, n)

    if (current !== session.current) return
    onComment(formatComment(n, view.getURL(), draft, note), filePaths)
    setDraft(null)
    arm(n)
  }

  return { active, draft, toggle, cancel, save, reset }
}

async function captureElement(view: WebviewTag, picked: PickedElement, n: number) {
  try {
    const image = await view.capturePage(captureArea(picked.rect))

    return await api.savePastedAttachments({
      paths: [],
      files: [
        {
          name: `browser-comment-${String(n)}.png`,
          type: 'image/png',
          bytes: new Uint8Array(image.toPNG()).buffer,
        },
      ],
    })
  } catch {
    // The comment still goes out without its screenshot.
    return []
  }
}
