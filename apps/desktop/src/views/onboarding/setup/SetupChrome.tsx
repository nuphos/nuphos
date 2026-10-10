import { Radio } from '@base-ui/react/radio'
import clsx from 'clsx'
import { Check, ChevronRight } from 'lucide-react'

import type { LocalAgentStatus } from './agentSetup'
import type { ReactNode } from 'react'

const STEPS = ['Local agents', 'Cloud agent'] as const

/** "1 Local agents — 2 Cloud agent", with the steps already passed checked off. */
export function SetupStepper({ step }: { step: 1 | 2 }) {
  return (
    <ol className="flex items-center justify-center gap-3 text-[12.5px]" aria-label="Setup steps">
      {STEPS.map((label, index) => {
        const number = index + 1
        const done = number < step
        const current = number === step

        return (
          <li key={label} className="flex items-center gap-3">
            {index > 0 && <span className="h-px w-10 bg-zGray-700" aria-hidden="true" />}
            <span
              aria-current={current ? 'step' : undefined}
              className={clsx('flex items-center gap-2', current ? 'text-main' : 'text-tertiary')}
            >
              <span
                className={clsx(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                  current || done ? 'bg-zViolet-500 text-white' : 'bg-zGray-800 text-tertiary',
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : number}
              </span>
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The centered column every setup screen uses: breadcrumb, heading, body, then its actions. */
export function SetupScreen({
  breadcrumb,
  title,
  subtitle,
  children,
  hint,
  actions,
}: {
  breadcrumb?: string
  title: string
  subtitle?: ReactNode
  children: ReactNode
  hint?: ReactNode
  actions: ReactNode
}) {
  return (
    <section className="mx-auto w-full max-w-[720px] space-y-6">
      <header className="space-y-2">
        {breadcrumb && (
          <p className="flex items-center gap-1 text-[12px] text-tertiary">
            {breadcrumb.split(' › ').map((part, index) => (
              <span key={part} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="h-3 w-3" />}
                {part}
              </span>
            ))}
          </p>
        )}
        <h1 className="text-[22px] font-semibold text-main">{title}</h1>
        {subtitle && <p className="text-[13.5px] leading-6 text-secondary">{subtitle}</p>}
      </header>
      {children}
      <footer className="flex items-center gap-3 border-t border-zGray-800/70 pt-4">
        <span className="min-w-0 flex-1 text-[12px] text-tertiary">{hint}</span>
        {actions}
      </footer>
    </section>
  )
}

const PILL: Record<LocalAgentStatus | 'connected', { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-success/15 text-success' },
  connected: { label: 'Connected', className: 'bg-success/15 text-success' },
  'signed-out': { label: 'Not signed in', className: 'bg-warning/15 text-warning' },
  missing: { label: 'Not installed', className: 'bg-zGray-800 text-tertiary' },
  checking: { label: 'Checking…', className: 'bg-zGray-800 text-tertiary' },
}

export function StatusPill({ status }: { status: LocalAgentStatus | 'connected' }) {
  const pill = PILL[status]

  return (
    <span
      className={clsx(
        'shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium',
        pill.className,
      )}
    >
      {pill.label}
    </span>
  )
}

/** A card-sized radio; must sit inside a Base UI `RadioGroup`. */
export function RadioCard({
  value,
  selected,
  icon,
  title,
  badge,
  description,
}: {
  value: string
  selected: boolean
  icon?: ReactNode
  title: string
  badge?: string
  description: string
}) {
  return (
    <Radio.Root
      value={value}
      className={clsx(
        'flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zViolet-accent',
        selected
          ? 'border-zViolet-accent bg-zViolet-accent/10'
          : 'border-zGray-800 bg-zGray-900 hover:border-zGray-700',
      )}
    >
      {icon && <span className="mt-0.5 text-secondary">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13.5px] font-medium text-main">
          {title}
          {badge && (
            <span className="rounded-full bg-zViolet-500/20 px-2 py-0.5 text-[11px] text-zViolet-300">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block text-[12.5px] leading-5 text-tertiary">{description}</span>
      </span>
      <Radio.Indicator
        keepMounted
        className={clsx(
          'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
          selected ? 'border-[4px] border-zViolet-accent bg-white' : 'border-zGray-600',
        )}
      />
    </Radio.Root>
  )
}
