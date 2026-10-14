import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'

import { MIN_RAIL_TURNS, pickRailTurns, turnPreview } from './railTurns'
import { TurnRailCard } from './TurnRailCard'
import { useTurnRail } from './useTurnRail'

import type { Message } from './model'
import type { KeyboardEvent, RefObject } from 'react'

// Widest the preview may be; narrower docked transcripts shrink it to fit.
const CARD_MAX_WIDTH = 320
const CARD_MIN_WIDTH = 160
// The first preview waits for the pointer to settle; later ones follow it.
const OPEN_DELAY_MS = 200
const CLOSE_DELAY_MS = 120
// Tick lengths in px. A full tick is the `w-[26px]` span; the rest are scaled
// from it so the length animates on the compositor.
const FULL_TICK = 26
const REST_TICK = 6
// By distance from the pointed tick: it, its neighbours, and so on.
const NEAR_TICKS = [26, 20, 14, 10]

const NAV_KEYS: Partial<Record<string, (i: number, n: number) => number>> = {
  ArrowUp: (i) => Math.max(0, i - 1),
  ArrowDown: (i, n) => Math.min(n - 1, i + 1),
  Home: () => 0,
  End: (_, n) => n - 1,
}

function tickScale(index: number, pointed: number | null): number {
  const near = pointed === null ? undefined : NEAR_TICKS[Math.abs(index - pointed)]

  return (near ?? REST_TICK) / FULL_TICK
}

// While pointing, only the pointed tick is lit, so the in-view range does not
// compete with it.
function tickTone(pointed: boolean, lit: boolean): string {
  if (pointed) return 'text-main opacity-100'

  return lit ? 'text-main opacity-60' : 'text-tertiary opacity-40'
}

/**
 * A tick per user turn beside the transcript. Ticks for the turns on screen
 * are lit; the ticks around the pointer grow like a magnified dock, and a
 * card previews the pointed turn. Clicking either jumps to that turn.
 */
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
  const { inView, jumpTo } = useTurnRail(scrollRef, turns, onBeforeJump)
  const [pointed, setPointed] = useState<number | null>(null)
  const [card, setCard] = useState<{ index: number; top: number; width: number } | null>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const timerRef = useRef(0)
  const cardOpenRef = useRef(false)
  const firstInView = turns.findIndex((t) => inView.has(t.id))
  const firstInViewId = turns[firstInView]?.id

  useEffect(() => {
    cardOpenRef.current = card !== null
  })
  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  // Keep the first lit tick inside the rail when the tick column scrolls.
  // Keyed on that id alone so streamed deltas do not force a layout read.
  useEffect(() => {
    const nav = navRef.current
    const tick = firstInViewId
      ? nav?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(firstInViewId)}"]`)
      : null

    if (!nav || !tick) return
    if (tick.offsetTop < nav.scrollTop) nav.scrollTop = tick.offsetTop
    else if (tick.offsetTop + tick.offsetHeight > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = tick.offsetTop + tick.offsetHeight - nav.clientHeight
    }
  }, [firstInViewId])

  if (turns.length < MIN_RAIL_TURNS) return null
  const tabStop = Math.max(0, firstInView)
  const focus = pointed ?? card?.index ?? null

  const placeCard = (index: number, button: HTMLElement) => {
    const rail = railRef.current?.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const room = (rail?.left ?? 0) - (scrollRef.current?.getBoundingClientRect().left ?? 0) - 16

    setCard({
      index,
      top: rect.top - (rail?.top ?? 0) + rect.height / 2,
      width: Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, room)),
    })
  }
  const point = (index: number, button: HTMLElement, immediate: boolean) => {
    window.clearTimeout(timerRef.current)
    setPointed(index)
    if (immediate || cardOpenRef.current) placeCard(index, button)
    else timerRef.current = window.setTimeout(() => placeCard(index, button), OPEN_DELAY_MS)
  }
  const leave = () => {
    window.clearTimeout(timerRef.current)
    setPointed(null)
    timerRef.current = window.setTimeout(() => setCard(null), CLOSE_DELAY_MS)
  }
  const jump = (id: string) => {
    window.clearTimeout(timerRef.current)
    setCard(null)
    jumpTo(id)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const move = NAV_KEYS[event.key]
    const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>('button')
    const current = Array.from(buttons ?? []).indexOf(event.target as HTMLButtonElement)

    if (!move || !buttons || current < 0) return
    event.preventDefault()
    buttons[move(current, buttons.length)].focus()
  }
  const cardTurn = card && turns[card.index]

  return (
    <div
      ref={railRef}
      className="absolute right-3 top-1/2 z-10 -translate-y-1/2"
      onPointerEnter={() => window.clearTimeout(timerRef.current)}
      onPointerLeave={leave}
    >
      <nav
        ref={navRef}
        aria-label="Conversation turns"
        onKeyDown={onKeyDown}
        onPointerLeave={() => setPointed(null)}
        onBlur={leave}
        className="scrollbar-none flex max-h-[60vh] flex-col overflow-y-auto overscroll-contain py-1"
      >
        {turns.map((turn, i) => {
          const lit = inView.has(turn.id)

          return (
            <button
              key={turn.id}
              type="button"
              data-turn-id={turn.id}
              tabIndex={i === tabStop ? 0 : -1}
              aria-label={`Turn ${String(i + 1)}: ${turn.title}`}
              aria-current={lit ? 'location' : undefined}
              onClick={() => jump(turn.id)}
              onPointerEnter={(e) => point(i, e.currentTarget, false)}
              onFocus={(e) => point(i, e.currentTarget, true)}
              className="flex h-2.5 w-9 shrink-0 items-center justify-end rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-zViolet-accent"
            >
              <span
                style={{ transform: `scaleX(${String(tickScale(i, focus))})` }}
                className={clsx(
                  'block h-0.5 w-[26px] origin-right rounded-full bg-current transition-[transform,opacity,color] duration-150 ease-out motion-reduce:transition-none',
                  tickTone(i === focus, lit && focus === null),
                )}
              />
            </button>
          )
        })}
      </nav>
      {cardTurn && (
        <TurnRailCard
          title={cardTurn.title}
          preview={turnPreview(messages, cardTurn)}
          top={card.top}
          width={card.width}
          onJump={() => jump(cardTurn.id)}
        />
      )}
    </div>
  )
}
