import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'

import { MIN_RAIL_TURNS, pickRailTurns, turnPreview } from './railTurns'
import { useTurnRail } from './useTurnRail'

import type { Message } from './model'
import type { KeyboardEvent, RefObject } from 'react'

// Widest the preview may be; narrower docked transcripts shrink it to fit.
const CARD_MAX_WIDTH = 256

const NAV_KEYS: Partial<Record<string, (i: number, n: number) => number>> = {
  ArrowUp: (i) => Math.max(0, i - 1),
  ArrowDown: (i, n) => Math.min(n - 1, i + 1),
  Home: () => 0,
  End: (_, n) => n - 1,
}

/** A tick per user turn beside the transcript; hover previews, click jumps. */
export function TurnRail({
  messages,
  scrollRef,
  onBeforeJump,
}: {
  messages: Message[]
  scrollRef: RefObject<HTMLDivElement | null>
  onBeforeJump: () => void
}) {
  const turns = useMemo(() => pickRailTurns(messages), [messages])
  const { activeId, jumpTo } = useTurnRail(scrollRef, turns, onBeforeJump)
  const [hover, setHover] = useState<{ index: number; top: number; width: number } | null>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const turnsRef = useRef(turns)

  useEffect(() => {
    turnsRef.current = turns
  })

  // Keep the current turn's tick inside the rail when the tick column scrolls.
  // Keyed on activeId alone so streamed deltas do not force a layout read.
  useEffect(() => {
    const nav = navRef.current
    const index = turnsRef.current.findIndex((t) => t.id === activeId)
    const tick = nav?.querySelectorAll<HTMLElement>('button')[Math.max(0, index)]

    if (!nav || !tick) return
    if (tick.offsetTop < nav.scrollTop) nav.scrollTop = tick.offsetTop
    else if (tick.offsetTop + tick.offsetHeight > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = tick.offsetTop + tick.offsetHeight - nav.clientHeight
    }
  }, [activeId])

  if (turns.length < MIN_RAIL_TURNS) return null
  const activeIndex = Math.max(
    0,
    turns.findIndex((t) => t.id === activeId),
  )

  const show = (index: number, button: HTMLElement) => {
    const rail = railRef.current?.getBoundingClientRect()
    const rect = button.getBoundingClientRect()

    const room = (rail?.left ?? 0) - (scrollRef.current?.getBoundingClientRect().left ?? 0) - 16

    setHover({
      index,
      top: rect.top - (rail?.top ?? 0) + rect.height / 2,
      width: Math.max(120, Math.min(CARD_MAX_WIDTH, room)),
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const move = NAV_KEYS[event.key]
    const buttons = railRef.current?.querySelectorAll<HTMLButtonElement>('button')
    const current = Array.from(buttons ?? []).indexOf(event.target as HTMLButtonElement)

    if (!move || !buttons || current < 0) return
    event.preventDefault()
    buttons[move(current, buttons.length)].focus()
  }
  const card = hover && turns[hover.index]
  const preview = card ? turnPreview(messages, card) : ''

  return (
    <div
      ref={railRef}
      className="absolute right-2.5 top-1/2 z-10 -translate-y-1/2"
      onMouseLeave={() => setHover(null)}
    >
      <nav
        ref={navRef}
        aria-label="Conversation turns"
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
        className="scrollbar-none flex max-h-[60vh] flex-col items-end overflow-y-auto py-1"
      >
        {turns.map((turn, i) => {
          const active = i === activeIndex

          return (
            <button
              key={turn.id}
              type="button"
              tabIndex={active ? 0 : -1}
              aria-label={`Turn: ${turn.title}`}
              aria-current={active ? 'location' : undefined}
              onClick={() => jumpTo(turn.id)}
              onMouseEnter={(e) => show(i, e.currentTarget)}
              onFocus={(e) => show(i, e.currentTarget)}
              className="group flex h-2.5 shrink-0 items-center justify-end rounded-sm px-1 outline-none focus-visible:ring-1 focus-visible:ring-zViolet-accent"
            >
              <span
                className={clsx(
                  'block h-[3px] rounded-full bg-current transition-[width,color] duration-150 group-hover:w-6',
                  active ? 'w-5 text-main' : 'w-3.5 text-zGray-600 group-hover:text-tertiary',
                )}
              />
            </button>
          )
        })}
      </nav>
      {card && (
        <div
          role="tooltip"
          style={{ top: hover.top, width: hover.width }}
          className="surface-raised pointer-events-none absolute right-full mr-2 -translate-y-1/2 rounded-lg border border-zGray-700/80 bg-elevated px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
        >
          <div className="truncate text-[12.5px] font-semibold text-main">{card.title}</div>
          {preview && (
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-tertiary">{preview}</div>
          )}
        </div>
      )}
    </div>
  )
}
