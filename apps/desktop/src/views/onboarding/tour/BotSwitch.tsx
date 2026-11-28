import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { AGENT_PROVIDER } from '../../../types/runtime'

import { Face, LabelPicker } from './BotParts'

import type { Side } from './BotParts'
import type { BotRuntimes } from './botRuntimes'

const spring = { type: 'spring', stiffness: 260, damping: 26 } as const

/** Her first answer comes this long after she shows up; she moves on her own at MOVE_AT. */
const ANSWER_AT = 700
const MOVE_AT = 2600
/** How long a move takes, runtime switch included, before she answers again. */
const SWITCH_MS = 900

/** From one machine's middle to the other's: a machine is 175px wide, 100px apart. */
const TRAVEL = 275

/**
 * A Bot, Frida, as the second page of the iOS tour shows her chat. Asked for something on this
 * computer, she starts on it with its runtime, then moves to the Box and goes on with the Box's:
 * a Bot is not tied to one computer or runtime. She sits over the machine she works on; the
 * computers' names below are the choice of where, and picking the other name, or clicking the
 * other computer, moves her. `onDone` hears when an answer after a move has landed, first after
 * she moves on her own; `onSide` follows her.
 */
export function BotSwitch({
  here,
  runtimes,
  onDone,
  onSide,
}: {
  /** This computer's name. */
  here: string
  runtimes: BotRuntimes
  onDone: () => void
  onSide: (onBox: boolean) => void
}) {
  const reduce = useReducedMotion() ?? false
  const [side, setSide] = useState<Side>(reduce ? 'box' : 'here')
  // Answered: she has replied on the side she is on. Moved: she has switched at least once.
  const [answered, setAnswered] = useState(reduce)
  const [moved, setMoved] = useState(reduce)
  const [switching, setSwitching] = useState(false)
  // Once she has moved on her own, the other choice glows once, until someone picks.
  const [nudge, setNudge] = useState(false)
  const done = useRef(onDone)
  const sided = useRef(onSide)
  const timer = useRef(0)

  useEffect(() => {
    done.current = onDone
    sided.current = onSide
  })

  const switchTo = (next: Side, auto = false) => {
    window.clearTimeout(timer.current)
    setSide(next)
    setMoved(true)
    if (!auto) setNudge(false)
    if (reduce) return
    setSwitching(true)
    setAnswered(false)
    timer.current = window.setTimeout(() => {
      setSwitching(false)
      setAnswered(true)
      if (auto) setNudge(true)
    }, SWITCH_MS)
  }
  const play = useRef(switchTo)

  useEffect(() => {
    play.current = switchTo
  })

  useEffect(() => {
    // With reduced motion she starts where the story ends.
    if (reduce) {
      done.current()

      return
    }
    const answer = window.setTimeout(() => setAnswered(true), ANSWER_AT)
    const move = window.setTimeout(() => play.current('box', true), MOVE_AT)

    return () => [answer, move, timer.current].forEach((id) => window.clearTimeout(id))
  }, [reduce])

  useEffect(() => sided.current(side === 'box'), [side])

  // Before she moves she has just started; after, the work is done wherever she is.
  const answer = moved
    ? t('Booked Thursday at 3 PM and replied to Dana.')
    : t('On it. I’ll check both calendars.')
  const reply = answered ? answer : null
  const other: Side = side === 'box' ? 'here' : 'box'
  const current = runtimes[side]
  const ready = moved && !switching
  const motionFor = (delay = 0) => (reduce ? { duration: 0 } : { ...spring, delay })

  return (
    <>
      {/* The other computer is a button too: hovering lifts it, clicking moves her there. */}
      <div className="tour-switches absolute inset-0 flex justify-center gap-[100px]">
        {(['here', 'box'] as const).map((target) => (
          <div key={target} className="relative w-[175px]">
            {target === other && (
              <button
                type="button"
                disabled={!ready}
                tabIndex={-1}
                aria-label={t('Switch Frida to {computer}', {
                  computer: target === 'box' ? 'InstaBox' : here,
                })}
                onClick={() => switchTo(target)}
                className="tour-switch absolute inset-x-0 top-[100px] bottom-12 rounded-2xl outline-none enabled:cursor-pointer"
              />
            )}
          </div>
        ))}
      </div>
      <LabelPicker
        side={side}
        names={{ here, box: 'InstaBox' }}
        disabled={!ready}
        nudge={nudge}
        reduce={reduce}
        onPick={switchTo}
      />
      {/* Over whichever computer she works on; she travels to the other when she moves. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[calc(100%-100px)] flex justify-center"
      >
        <div className="relative h-0 w-[450px]">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, x: side === 'box' ? TRAVEL : 0 }}
            transition={motionFor()}
            className="absolute bottom-0 left-[-92.5px] flex w-[360px] flex-col gap-2 text-left"
          >
            <p className="ml-12 self-end rounded-2xl border border-line-control bg-state-selected px-3 py-1.5 text-[12.5px] text-primary">
              {t('Find a time with Dana next week and reply to her email.')}
            </p>
            {/* One line at a time: her answer, or the runtime she is switching to. It holds a
                line's height, so the chat does not jump. */}
            <div className="min-h-[30px]">
              <AnimatePresence mode="wait">
                {switching && (
                  <motion.p
                    key={`to-${side}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.2 }}
                    className="flex h-[30px] items-center justify-center gap-1.5 text-[11.5px] text-tertiary"
                  >
                    <span className="h-px w-6 bg-line-control" />
                    {t('Switching to {runtime}…', { runtime: AGENT_PROVIDER[current].label })}
                    <span className="h-px w-6 bg-line-control" />
                  </motion.p>
                )}
                {reply && (
                  <motion.p
                    key={`${side}-${reply}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.2 } }}
                    transition={motionFor()}
                    onAnimationComplete={moved ? () => done.current() : undefined}
                    className="mr-4 w-fit rounded-2xl bg-surface-sunken px-3 py-1.5 text-[12.5px] text-primary"
                  >
                    {reply}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <div className="flex items-center gap-2 self-center rounded-full border border-line-control bg-surface-raised py-1 pl-1 pr-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
              <Face switching={switching} provider={current} reduce={reduce} />
              <span className="text-[13px] font-medium text-primary">Frida</span>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  )
}
