import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { useStableCallback } from '../../hooks/useStableCallback'
import { findOffsets } from '../../lib/findOffsets'
import { isMac } from '../../lib/platform'

import type { RefObject } from 'react'

// Electron ships no find-in-page UI, and webContents.findInPage searches the
// whole window (sidebar, other panes, this input). The CSS Custom Highlight
// API marks matches inside one pane's transcript without touching its DOM.
const ALL_MATCHES = 'session-find'
const CURRENT_MATCH = 'session-find-current'
// A one-character query can match most of a long transcript; past this the
// count is shown as "1000+" and the rest is reached by refining the query.
const MATCH_LIMIT = 1000

type Step = 'new' | 'refresh' | 1 | -1

function findRanges(root: HTMLElement, query: string): Range[] {
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''

  // Messages only: the pane also holds the conversation rail, the composer
  // draft and side panels. Matches are searched across node boundaries, so a
  // hit inside syntax-highlighted code or inline formatting is still found.
  for (const message of root.querySelectorAll('[data-message-id]')) {
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.checkVisibility()) continue
      starts.push(text.length)
      nodes.push(node as Text)
      text += (node as Text).data
    }
  }
  let cursor = 0
  const locate = (offset: number, end: boolean): [Text, number] => {
    // An end offset on a node boundary belongs to the node it closes.
    while (cursor + 1 < nodes.length && starts[cursor + 1] < offset + (end ? 0 : 1)) cursor++

    return [nodes[cursor], offset - starts[cursor]]
  }

  return findOffsets(text, query, MATCH_LIMIT).map((offset) => {
    const range = new Range()

    range.setStart(...locate(offset, false))
    range.setEnd(...locate(offset + query.length, true))

    return range
  })
}

// A new query starts from what is on screen instead of jumping to the top of
// the transcript. Ranges are in document order, so bisect for the first one
// not above the pane.
function firstInView(root: HTMLElement, ranges: Range[]): number {
  const top = root.getBoundingClientRect().top
  let low = 0
  let high = ranges.length

  while (low < high) {
    const middle = (low + high) >> 1

    if (ranges[middle].getBoundingClientRect().bottom > top) high = middle
    else low = middle + 1
  }

  return Math.min(low, Math.max(ranges.length - 1, 0))
}

// scrollIntoView works on elements, and the element holding a match can be far
// taller than its scroller (a long command output), so centre the range itself
// in every scroller between it and the pane.
function revealRange(root: HTMLElement, range: Range) {
  for (let el = range.startContainer.parentElement; el && el !== root; el = el.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(el).overflowY)) continue
    const offset = range.getBoundingClientRect().top - el.getBoundingClientRect().top

    el.scrollTop += offset - el.clientHeight / 2
  }
}

function FindBar({
  rootRef,
  inputRef,
  onClose,
}: {
  rootRef: RefObject<HTMLElement | null>
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState({ index: 0, count: 0, partial: false })

  const search = useStableCallback((text: string, step: Step) => {
    const root = rootRef.current
    const ranges = root ? findRanges(root, text) : []
    const last = Math.max(ranges.length - 1, 0)
    let index = Math.min(result.index, last)

    if (step === 'new') index = root ? firstInView(root, ranges) : 0
    else if (step !== 'refresh') index = (result.index + step + ranges.length) % (last + 1)

    CSS.highlights.set(ALL_MATCHES, new Highlight(...ranges))
    CSS.highlights.set(CURRENT_MATCH, new Highlight(...ranges.slice(index, index + 1)))
    if (step !== 'refresh' && root && ranges[index]) revealRange(root, ranges[index])
    setResult({
      index,
      count: ranges.length,
      partial: Boolean(root?.querySelector('[data-earlier-messages]')),
    })
  })

  useEffect(
    () => () => {
      CSS.highlights.delete(ALL_MATCHES)
      CSS.highlights.delete(CURRENT_MATCH)
    },
    [],
  )

  // The transcript changes under an open bar (a streaming reply, earlier
  // messages loading), which would leave the count and highlights stale.
  useEffect(() => {
    const root = rootRef.current

    if (!root || !query) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      timer ??= setTimeout(() => {
        timer = undefined
        search(query, 'refresh')
      }, 250)
    })

    observer.observe(root, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [query, rootRef, search])

  const buttonClass =
    'flex h-6 w-6 items-center justify-center rounded text-tertiary transition-colors hover:bg-zGray-800/70 hover:text-main disabled:opacity-40'

  return (
    <InputGroup className="surface-raised absolute right-4 top-[52px] z-30 rounded-lg bg-agentCanvas py-1 pl-2.5 pr-1 text-[12px]">
      <div className="flex items-center gap-0.5">
        <InputGroupInput
          ref={inputRef}
          autoFocus
          value={query}
          placeholder="Find in conversation"
          aria-label="Find in conversation"
          className="w-44 text-main placeholder:text-tertiary"
          onChange={(event) => {
            setQuery(event.target.value)
            // Uncommitted IME text is not what the user is looking for; the
            // search runs once the composition ends.
            if (!(event.nativeEvent as InputEvent).isComposing) search(event.target.value, 'new')
          }}
          onCompositionEnd={(event) => search(event.currentTarget.value, 'new')}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') {
              // Esc also stops a running response; here it only closes the bar.
              event.stopPropagation()
              onClose()
            } else if (event.key === 'Enter') {
              search(query, event.shiftKey ? -1 : 1)
            }
          }}
        />
        <span className="px-1 tabular-nums text-tertiary">
          {result.count === 0 ? 0 : result.index + 1}/{result.count}
          {result.count === MATCH_LIMIT && '+'}
        </span>
        <button
          type="button"
          className={buttonClass}
          disabled={result.count === 0}
          onClick={() => search(query, -1)}
          title="Previous match"
          aria-label="Previous match"
        >
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={result.count === 0}
          onClick={() => search(query, 1)}
          title="Next match"
          aria-label="Next match"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={onClose}
          title="Close"
          aria-label="Close find"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      {result.partial && (
        <div className="pb-0.5 pt-1 text-[11px] text-tertiary">
          Earlier messages are not loaded and are not searched.
        </div>
      )}
    </InputGroup>
  )
}

/** ⌘F for one session pane: searches the messages rendered inside `rootRef`. */
export function SessionFindBar({
  rootRef,
  active,
}: {
  rootRef: RefObject<HTMLElement | null>
  /** Whether this is the pane keyboard input currently belongs to. */
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+F on macOS is forward-char in text fields.
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) return
      // An editor that handles ⌘F itself (YAML, query consoles) keeps it, and
      // so does anything focused in the workspace tab beside the session.
      if (event.key.toLowerCase() !== 'f' || event.defaultPrevented) return
      if (document.activeElement?.closest('[data-workspace-focus-surface="tab"]')) return
      const root = rootRef.current
      const box = root?.getBoundingClientRect()

      // Only when the transcript is what is on screen: not hidden behind
      // Settings or an expanded dock, and not covered by a modal.
      if (!root || !box) return
      const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)

      if (!root.contains(centre)) return
      event.preventDefault()
      setOpen(true)
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, rootRef])

  if (!open || !active) return null

  return <FindBar rootRef={rootRef} inputRef={inputRef} onClose={() => setOpen(false)} />
}
