import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { findOffsets } from '../../lib/findOffsets'

import type { RefObject } from 'react'

// Electron ships no find-in-page UI, and webContents.findInPage searches the
// whole window (sidebar, other panes, this input). The CSS Custom Highlight
// API marks matches inside one pane's transcript without touching its DOM.
const ALL_MATCHES = 'session-find'
const CURRENT_MATCH = 'session-find-current'

function findRanges(root: HTMLElement, query: string): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''

  // Matches are searched across node boundaries, so a hit inside
  // syntax-highlighted code or inline formatting is still found.
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.checkVisibility()) continue
    starts.push(text.length)
    nodes.push(node as Text)
    text += (node as Text).data
  }
  let cursor = 0
  const locate = (offset: number, end: boolean): [Text, number] => {
    // An end offset on a node boundary belongs to the node it closes.
    while (cursor + 1 < nodes.length && starts[cursor + 1] < offset + (end ? 0 : 1)) cursor++

    return [nodes[cursor], offset - starts[cursor]]
  }

  return findOffsets(text, query).map((offset) => {
    const range = new Range()

    range.setStart(...locate(offset, false))
    range.setEnd(...locate(offset + query.length, true))

    return range
  })
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
  const [position, setPosition] = useState({ index: 0, count: 0 })

  useEffect(
    () => () => {
      CSS.highlights.delete(ALL_MATCHES)
      CSS.highlights.delete(CURRENT_MATCH)
    },
    [],
  )

  // Re-searched on every step rather than cached: the transcript keeps growing
  // while a turn streams.
  const search = (text: string, step: number) => {
    const root = rootRef.current
    const ranges = root ? findRanges(root, text) : []
    const index = step === 0 ? 0 : (position.index + step + ranges.length) % (ranges.length || 1)

    CSS.highlights.set(ALL_MATCHES, new Highlight(...ranges))
    CSS.highlights.set(CURRENT_MATCH, new Highlight(...ranges.slice(index, index + 1)))
    if (root && ranges[index]) revealRange(root, ranges[index])
    setPosition({ index, count: ranges.length })
  }
  const buttonClass =
    'flex h-6 w-6 items-center justify-center rounded text-tertiary transition-colors hover:bg-zGray-800/70 hover:text-main disabled:opacity-40'

  return (
    <InputGroup className="surface-raised absolute right-4 top-[52px] z-30 flex items-center gap-0.5 rounded-lg bg-agentCanvas py-1 pl-2.5 pr-1 text-[12px]">
      <InputGroupInput
        ref={inputRef}
        autoFocus
        value={query}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        className="w-44 text-main placeholder:text-tertiary"
        onChange={(event) => {
          setQuery(event.target.value)
          search(event.target.value, 0)
        }}
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
        {position.count === 0 ? 0 : position.index + 1}/{position.count}
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={position.count === 0}
        onClick={() => search(query, -1)}
        title="Previous match"
        aria-label="Previous match"
      >
        <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={position.count === 0}
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
    </InputGroup>
  )
}

/** ⌘F for one session pane: searches the text rendered inside `rootRef`. */
export function SessionFindBar({
  rootRef,
  active,
}: {
  rootRef: RefObject<HTMLElement | null>
  /** Whether this pane's session is what the user is looking at. */
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      // An editor that handles ⌘F itself (YAML, query consoles) keeps it, and
      // so does anything focused in the workspace tab beside the session.
      if (event.key.toLowerCase() !== 'f' || event.defaultPrevented) return
      if (document.activeElement?.closest('[data-workspace-focus-surface="tab"]')) return
      event.preventDefault()
      setOpen(true)
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  if (!open || !active) return null

  return <FindBar rootRef={rootRef} inputRef={inputRef} onClose={() => setOpen(false)} />
}
