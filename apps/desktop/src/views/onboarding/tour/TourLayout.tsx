import clsx from 'clsx'
import { motion, useReducedMotion } from 'framer-motion'

import type { ReactNode } from 'react'

export const TOUR_PAGES = 4

/** Title and subtitle, the page's art, its dots, then its buttons — one centered column. */
export function TourLayout({
  title,
  subtitle,
  art,
  dot,
  revealed,
  note,
  actions,
}: {
  title: ReactNode
  subtitle: ReactNode
  art: ReactNode
  /** Which of the four intro pages this is; the claim page has no dots. */
  dot?: number
  revealed: boolean
  /** A line above the buttons: an error or a hint. */
  note?: ReactNode
  actions: ReactNode
}) {
  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-7 text-center">
      <header className="space-y-2.5">
        <h1 className="text-[24px] font-semibold leading-tight text-main">{title}</h1>
        <p className="mx-auto max-w-[480px] text-[14px] leading-6 text-secondary">{subtitle}</p>
      </header>
      <div className="flex w-full justify-center">{art}</div>
      {dot !== undefined && <PageDots current={dot} />}
      <Reveal shown={revealed}>
        <div className="flex min-h-9 flex-col items-center gap-3">
          {note}
          <div className="flex items-center justify-center gap-2.5">{actions}</div>
        </div>
      </Reveal>
    </section>
  )
}

function PageDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: TOUR_PAGES }, (_, index) => (
        <span
          key={index}
          className={clsx(
            'h-1.5 rounded-full transition-[width,background-color] duration-300',
            index === current ? 'w-3.5 bg-action-primary' : 'w-1.5 bg-line-control',
          )}
        />
      ))}
    </div>
  )
}

/** The button fades in and rises once the page's demo has played; at once with reduced motion. */
export function Reveal({ shown, children }: { shown: boolean; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false

  return (
    <motion.div
      className={clsx('w-full', !shown && 'pointer-events-none')}
      initial={false}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: 'easeOut' }}
      aria-hidden={!shown}
      inert={!shown}
    >
      {children}
    </motion.div>
  )
}
