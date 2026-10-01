import { motion } from 'framer-motion'

import { Reveal } from './chat-bits'
import { EASE_OUT, POINT_DURATION } from './shared'

import type { ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

// The fifth screen: the four claims put back together. Read one at a time they
// are four separate promises; the point Nuphos actually makes is what they add
// up to, so the set gets a page of its own before anything is asked for.
const TAME_ROW_STAGGER = 0.22
const TAME_FOOTER_DELAY = 1.1

// End of the summary card's own cascade — its footer is the last thing in, so
// whatever follows the card waits for that rather than a guessed delay.
export const TAME_CASCADE = TAME_FOOTER_DELAY + POINT_DURATION
const TAME_SUMMARY: { letter: string; title: string; gist: string }[] = [
  {
    letter: 'T',
    title: 'Trust',
    gist: 'Bounded by a role you set, held for your approval, logged either way.',
  },
  {
    letter: 'A',
    title: 'Action',
    gist: 'Inspects, plans, and asks — inside those bounds, it does the real work.',
  },
  { letter: 'M', title: 'Memory', gist: 'Learns your services and history, and keeps them.' },
  {
    letter: 'E',
    title: 'Experience',
    gist: 'One workspace for you and the agent, reachable from where you already are.',
  },
]

export function TameSummary({ reduce, skip }: { reduce: boolean; skip: boolean }) {
  return (
    <Reveal
      reduce={reduce}
      skip={skip}
      className="overflow-hidden rounded-2xl border border-zGray-800 bg-zGray-900/40"
    >
      <div className="space-y-3 p-4">
        {TAME_SUMMARY.map(({ letter, title, gist }, i) => (
          <Reveal
            key={letter}
            reduce={reduce}
            skip={skip}
            delay={0.15 + i * TAME_ROW_STAGGER}
            className="flex items-start gap-3"
          >
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-zViolet-500/40 bg-zViolet-500/10 text-[13px] font-semibold text-zViolet-300">
              {letter}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-main">{title}</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-tertiary">{gist}</div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal
        reduce={reduce}
        skip={skip}
        delay={TAME_FOOTER_DELAY}
        className="border-t border-zGray-800/70 bg-zGray-950/30 px-4 py-3 text-[12px] leading-relaxed text-tertiary"
      >
        The power of terminal agents, <span className="font-medium text-secondary">TAMEd</span> for
        production DevOps.
      </Reveal>
    </Reveal>
  )
}

// The shared card shell for all four value props: a demo panel on top, and
// the "N of 4" index, heading and claim below it. Cards cross-fade via the parent's AnimatePresence (`mode="wait"`, keyed
// on `index`) — `skip` (passed through to each inner Reveal, and as
// `initial={false}` here) renders the active card at rest with no cascade for
// history mounts or any screen past the first. Navigation (the quiet back
// link, the canned-reply/exit button) lives in the surrounding screen now,
// not in the card itself.
export function ValuePropCard({
  index,
  icon: Icon,
  title,
  body,
  demo,
  reduce,
  skip,
  history,
}: {
  index: number
  icon: typeof ShieldCheck
  title: string
  body: string
  demo: ReactNode
  reduce: boolean
  /** Render the contents at rest — no staggered reveal. True after the first
   *  card has been seen, so stepping between claims swaps rather than replays. */
  skip: boolean
  /** Mounted as settled history (dev jump): don't animate the swap either. */
  history: boolean
}) {
  return (
    <motion.div
      initial={
        history ? false : reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(4px)' }
      }
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(4px)' }}
      transition={{ duration: history ? 0 : 0.22, ease: EASE_OUT }}
      className="overflow-hidden rounded-2xl border border-zGray-800 bg-zGray-900/40"
    >
      {/* The claim, playing — not a picture of it. */}
      <Reveal
        reduce={reduce}
        skip={skip}
        delay={0.1}
        className="border-b border-zGray-800/70 bg-zGray-950/30 p-3.5"
      >
        {demo}
      </Reveal>

      <div className="space-y-3 p-4">
        <Reveal reduce={reduce} skip={skip} delay={0.5}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
            {index + 1} of 4
          </div>
          <div className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-main">
            <Icon className="h-4 w-4 text-zViolet-300" strokeWidth={2} />
            {title}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{body}</p>
        </Reveal>
      </div>
    </motion.div>
  )
}
