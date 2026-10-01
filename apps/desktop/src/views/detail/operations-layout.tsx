import clsx from 'clsx'

import { healthClass } from '../../lib/k8sHealth'

import type { HealthTone } from '../../lib/k8sHealth'
import type { ReactNode } from 'react'

export function OperationsCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-main p-3 @2xl:p-4 @5xl:p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 @2xl:gap-4">{children}</div>
    </div>
  )
}

const toneSurface: Record<HealthTone, string> = {
  success: 'bg-success/10 ring-success/15',
  warning: 'bg-warning/10 ring-warning/15',
  error: 'bg-error/10 ring-error/15',
  neutral: 'bg-zGray-800 ring-zGray-700',
}

export function OperationsHero({
  eyebrow,
  title,
  description,
  tone,
  badge,
  facts,
}: {
  eyebrow: string
  title: string
  description: ReactNode
  tone: HealthTone
  badge: ReactNode
  facts: { label: string; value: ReactNode; detail?: ReactNode }[]
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-zGray-800 bg-zGray-900 shadow-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-zViolet-500/[0.08] blur-3xl"
      />
      <div className="relative grid min-w-0 grid-cols-1 @5xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.45fr)]">
        <div className="flex min-w-0 items-start gap-3.5 border-b border-zGray-800 p-5 @2xl:p-6 @5xl:border-b-0 @5xl:border-r">
          <span
            className={clsx(
              'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
              toneSurface[tone],
            )}
          >
            <span className={clsx('h-2.5 w-2.5 rounded-full bg-current', healthClass[tone])} />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {eyebrow}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-main">{title}</h2>
              {badge}
            </div>
            <div className="mt-1.5 max-w-xl text-[12px] leading-5 text-secondary">
              {description}
            </div>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-px bg-zGray-800 @2xl:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0 bg-zGray-900 px-4 py-4 @2xl:px-5 @2xl:py-5">
              <div className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-tertiary">
                {fact.label}
              </div>
              <div className="mt-1 min-w-0 truncate text-[13px] font-semibold text-main">
                {fact.value}
              </div>
              {fact.detail && (
                <div className="mt-0.5 min-w-0 truncate text-[10.5px] text-tertiary">
                  {fact.detail}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function OperationsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 @2xl:gap-4 @5xl:grid-cols-12">{children}</div>
  )
}

export function OperationsPanel({
  title,
  description,
  meta,
  icon,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: string
  meta?: ReactNode
  icon?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section
      className={clsx(
        'min-w-0 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-sm',
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-zGray-800 px-4 py-3.5 @2xl:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zGray-800 text-secondary">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-main">{title}</h3>
            {description && (
              <div className="mt-0.5 truncate text-[10.5px] text-tertiary">{description}</div>
            )}
          </div>
        </div>
        {meta && <div className="shrink-0 text-[11px] text-tertiary">{meta}</div>}
      </div>
      <div className={clsx('min-w-0', bodyClassName)}>{children}</div>
    </section>
  )
}

export function ProgressFact({
  label,
  value,
  desired,
  tone,
}: {
  label: string
  value: number
  desired: number
  tone: HealthTone
}) {
  const fraction = desired <= 0 ? 0 : Math.min(1, Math.max(0, value / desired))
  const fillClass: Record<HealthTone, string> = {
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    neutral: 'bg-zGray-600',
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-secondary">{label}</span>
        <span className={clsx('font-mono text-[11px] font-medium', healthClass[tone])}>
          {value} / {desired}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zGray-800">
        <div
          className={clsx('h-full rounded-full transition-[width] duration-300', fillClass[tone])}
          style={{ width: `${String(fraction * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function FactRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4 border-b border-zGray-800 py-2.5 last:border-b-0">
      <span className="shrink-0 text-[11px] text-tertiary">{label}</span>
      <span
        className={clsx(
          'min-w-0 break-all text-right text-[11.5px] text-secondary',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  )
}
