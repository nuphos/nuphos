import clsx from 'clsx'
import { Monitor } from 'lucide-react'

import { PageMeta } from '../app/pageMeta'
import { t } from '../i18n'

import type { DesktopPhase } from '../lib/desktopConnection'

/** The desktop's frame: its name in the header, and what stands between the user and it. */
export function DesktopFrame({
  title,
  phase,
  status,
  action,
  switcher,
  onRetry,
  host,
}: {
  title: string
  phase: DesktopPhase
  status?: string
  action?: React.ReactNode
  /** Which of the Box's displays to show, for a Box's desktop. */
  switcher?: React.ReactNode
  onRetry: () => void
  host: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <PageMeta pageKey="team.desktop" title={title} icon={<Monitor className="h-3.5 w-3.5" />}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line-control px-3 py-1.5 text-xs text-tertiary">
          <span className="max-w-[40%] shrink-0 truncate font-medium text-main" title={title}>
            {title}
          </span>
          {switcher}
          <span className="min-w-0 flex-1 truncate">{status}</span>
          {phase.kind === 'connected' && action}
        </div>
        <DesktopScreen phase={phase} onRetry={onRetry} host={host} className="min-h-0 flex-1" />
      </div>
    </PageMeta>
  )
}

/**
 * The live desktop itself, and the one state that stands in for it while it
 * connects, reconnects, or is offline: the same wherever a desktop is shown.
 */
export function DesktopScreen({
  phase,
  onRetry,
  host,
  className,
  children,
}: {
  phase: DesktopPhase
  onRetry: () => void
  host: React.RefObject<HTMLDivElement | null>
  className?: string
  /** Drawn over the live picture once it shows. */
  children?: React.ReactNode
}) {
  const overlay =
    phase.kind === 'connecting'
      ? t('Connecting to the desktop…')
      : phase.kind === 'reconnecting'
        ? t('Reconnecting…')
        : undefined

  return (
    <div className={clsx('relative', className)}>
      <div ref={host} className="absolute inset-0 flex" />
      {overlay || phase.kind === 'stopped' ? (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-state-selected text-sm text-secondary"
        >
          {phase.kind === 'stopped' ? phase.message : overlay}
          {phase.kind === 'stopped' && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-line-control px-2 py-0.5 text-xs text-main hover:bg-state-hover"
            >
              {phase.reason === 'offline' ? t('Resume') : t('Try again')}
            </button>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
