import clsx from 'clsx'

import { t } from '../../../i18n'

import type { LocalAgentStatus } from './agentSetup'
import type { ReactNode } from 'react'

/** The centered column every setup screen uses: heading, body, then its actions. */
export function SetupScreen({
  title,
  step,
  subtitle,
  children,
  hint,
  actions,
}: {
  title: string
  step?: 2 | 3
  subtitle?: ReactNode
  children: ReactNode
  hint?: ReactNode
  actions: ReactNode
}) {
  return (
    <section className="mx-auto w-full max-w-[600px] space-y-6">
      <header className="space-y-2">
        {step && (
          <p className="pb-2 text-[12px] text-tertiary">
            {t('Step {step} of 3', { step })} · {step === 2 ? t('Runtimes') : t('Ready')}
          </p>
        )}
        <h1 className="text-[22px] font-semibold text-main">{title}</h1>
        {subtitle && <p className="text-[13.5px] leading-6 text-secondary">{subtitle}</p>}
      </header>
      {children}
      <footer className="flex items-center gap-3 border-t border-line-control/70 pt-4">
        <span className="min-w-0 flex-1 text-[12px] text-tertiary">{hint}</span>
        {actions}
      </footer>
    </section>
  )
}

const PILL: Record<LocalAgentStatus, { label: string; className: string }> = {
  unavailable: { label: t('Unavailable'), className: 'bg-surface-sunken text-tertiary' },
  ready: { label: t('Ready'), className: 'bg-success/15 text-success' },
  'signed-out': { label: t('Not signed in'), className: 'bg-warning/15 text-warning' },
  missing: { label: t('Not installed'), className: 'bg-surface-sunken text-tertiary' },
  checking: { label: t('Checking…'), className: 'bg-surface-sunken text-tertiary' },
}

export function StatusPill({ status }: { status: LocalAgentStatus }) {
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
