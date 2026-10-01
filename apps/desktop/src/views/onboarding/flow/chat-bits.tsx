import { Button as BaseButton } from '@base-ui/react/button'
import { motion } from 'framer-motion'
import { ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CloudLogo } from '../../../components/CloudLogo'

import { EASE_OUT, POINT_DURATION, POINT_STAGGER, providerLabel } from './shared'
import { StreamText } from './stream'

import type { OnboardingProvider, ValuePropPoint } from './shared'
import type { ReactNode } from 'react'

// The claim's supporting points, staggered in under the agent's answer.
export function ValuePropPoints({
  points,
  reduce,
  skip,
}: {
  points: ValuePropPoint[]
  reduce: boolean
  skip: boolean
}) {
  return (
    <div className="space-y-1.5">
      {points.map(({ icon: Icon, title, body }, i) => (
        <Reveal
          key={title}
          reduce={reduce}
          skip={skip}
          delay={i * POINT_STAGGER}
          className="flex items-start gap-2.5"
        >
          <Icon className="mt-[3px] h-3.5 w-3.5 flex-shrink-0 text-zViolet-300" strokeWidth={2} />
          <p className="min-w-0 text-[12.5px] leading-relaxed text-tertiary">
            <span className="font-medium text-main">{title}</span> — {body}
          </p>
        </Reveal>
      ))}
    </div>
  )
}

// One item in a sequential reveal: fades/rises in after `delay` seconds.
// `skip` renders it statically (history that shouldn't re-animate).
export function Reveal({
  reduce,
  skip = false,
  delay = 0,
  className,
  children,
}: {
  reduce: boolean
  skip?: boolean
  delay?: number
  className?: string
  children: ReactNode
}) {
  if (skip) return <div className={className}>{children}</div>

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(4px)' }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ delay: reduce ? 0 : delay, duration: POINT_DURATION, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// User message — right-aligned gray bubble, matching the real agent panel.
export function UserMsg({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="flex flex-col items-end"
    >
      <div className="max-w-[85%] break-words rounded-2xl border border-zGray-800 bg-zGray-800/60 px-3.5 py-2 text-[14.5px] text-main">
        {children}
      </div>
    </motion.div>
  )
}

// The single cloud-provider chip shown inline in the conversation for the
// integration step. Onboarding never performs a real bind, so
// there's nothing to pick between — AWS is the one demo path, and Continue
// moves on to Slack whether or not the user played it.
export function IntegrationChips({
  reduce,
  onPick,
  onNext,
}: {
  reduce: boolean
  onPick: (provider: OnboardingProvider) => void
  onNext: () => void
}) {
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.4, ease: EASE_OUT }}
      className="flex flex-wrap gap-2 pt-1"
    >
      <BaseButton
        onClick={() => onPick('aws')}
        className="titlebar-no-drag group inline-flex items-center gap-2 rounded-xl border border-zGray-800 bg-zGray-900/40 px-3.5 py-2 text-[13px] text-main transition-colors hover:border-zViolet-500/50 hover:bg-zGray-800/60 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/50"
      >
        <CloudLogo provider="aws" size={16} />
        {providerLabel('aws')}
      </BaseButton>
      <BaseButton
        onClick={onNext}
        className="titlebar-no-drag inline-flex items-center rounded-xl px-3.5 py-2 text-[13px] text-tertiary transition-colors hover:text-secondary outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/50"
      >
        Continue
      </BaseButton>
    </motion.div>
  )
}

// Shimmer progress lines for the simulated bind demo below — hoisted to
// module scope so the effect there can depend on `reduce` alone without an
// exhaustive-deps suppression (the array is a stable reference, never
// recreated per render).
const SIMULATED_BIND_STEPS = [
  'Creating a dedicated, read-only role…',
  'Running a first audit of your resources…',
]

// Onboarding never performs a real bind: instead of opening
// BindAccountDialog, this plays a short scripted version of what connecting a
// provider looks like, then says plainly that nothing here was actually
// created. `skip` renders it fully settled at once (dev jump landed past this
// step); `onDone` fires once the closing line has landed.
export function SimulatedBindDemo({
  provider,
  reduce,
  skip,
  onDone,
}: {
  provider: OnboardingProvider
  reduce: boolean
  skip: boolean
  onDone: () => void
}) {
  const [shown, setShown] = useState(skip || reduce ? SIMULATED_BIND_STEPS.length : 0)
  const [settled, setSettled] = useState(skip || reduce)
  // Reduce-motion can flip true mid-play (not just on mount). Rather than
  // resyncing `shown`/`settled` from inside the effect (which would call
  // setState synchronously in an effect body — already flagged elsewhere in
  // this file as an anti-pattern, and doubling that lint violation isn't
  // worth it here), derive the display values in render: once `skip` or
  // `reduce` is true, treat the demo as fully shown/settled regardless of
  // where the timers had gotten to.
  const effectiveShown = skip || reduce ? SIMULATED_BIND_STEPS.length : shown
  const effectiveSettled = skip || reduce || settled

  useEffect(() => {
    if (skip || reduce) {
      // Already rendered settled above; StreamText's own skip path below
      // fires `onDone` immediately, so there's nothing to schedule here.
      return
    }
    const timers: number[] = []

    SIMULATED_BIND_STEPS.forEach((_, i) =>
      timers.push(window.setTimeout(() => setShown(i + 1), 600 + i * 800)),
    )
    timers.push(window.setTimeout(() => setSettled(true), 600 + SIMULATED_BIND_STEPS.length * 800))

    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [skip, reduce])

  return (
    <>
      <UserMsg>Help me integrate {providerLabel(provider)}.</UserMsg>
      {SIMULATED_BIND_STEPS.slice(0, effectiveShown).map((step, i) => (
        <div key={step} className="text-[12.5px] text-tertiary">
          {i === effectiveShown - 1 && !effectiveSettled ? (
            <span className="codex-shimmer-text t-text-swap">{step}</span>
          ) : (
            <span>{step}</span>
          )}
        </div>
      ))}
      {effectiveSettled && (
        <StreamText
          reduce={reduce}
          skip={skip}
          startDelay={250}
          segments={[
            "That's it — ",
            { text: providerLabel(provider), className: 'font-medium' },
            ' would be connected, read-only from the start. Nothing here was actually created; you can connect for real anytime from Connectors.',
          ]}
          onDone={onDone}
        />
      )}
    </>
  )
}

// A reply the user can send without typing it. It stays on their side of the
// conversation and in their voice, but it must not be mistakable for a message
// they already sent: built like UserMsg it read as settled history, so nobody
// tried clicking it. The violet outline and the send glyph are what say
// "press this" — filled violet stays reserved for the agent's own offers, so
// the two never blur into each other.
export function CannedReplyButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="flex justify-end">
      <BaseButton
        onClick={onClick}
        className="titlebar-no-drag group inline-flex max-w-[85%] items-center gap-2.5 rounded-2xl border border-zViolet-500/50 bg-zViolet-500/5 px-3.5 py-2 text-left text-[14.5px] text-main transition-colors hover:border-zViolet-400 hover:bg-zViolet-500/15 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-400/50"
      >
        <span>{children}</span>
        <span
          aria-hidden
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-zViolet-500/20 text-zViolet-300 transition-colors group-hover:bg-zViolet-500 group-hover:text-white"
        >
          <ArrowUp className="h-3 w-3" strokeWidth={2.6} />
        </span>
      </BaseButton>
    </div>
  )
}
