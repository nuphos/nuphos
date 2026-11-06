import clsx from 'clsx'

export type StatusDotTone = 'attention' | 'unread' | 'running' | 'warning' | 'danger'

const toneClasses: Record<StatusDotTone, string> = {
  // Waiting on the person: the one pigment reserved for "needs you".
  attention: 'bg-status-attention',
  // Something new to read, but nothing is blocked: plain ink.
  unread: 'bg-action-primary',
  running: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
}

/** A 6px state marker. `label` names the state for assistive technology and the hover title. */
export function StatusDot({
  tone,
  label,
  className,
}: {
  tone: StatusDotTone
  label: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={clsx('inline-block size-1.5 shrink-0 rounded-full', toneClasses[tone], className)}
    />
  )
}
