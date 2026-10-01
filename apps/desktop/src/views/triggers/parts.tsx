import clsx from 'clsx'
import { Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AppSelect } from '../../components/ui/select'

import type { TeamMember } from '../../types'
import type { Clock } from 'lucide-react'

/**
 * Who this automation runs as, and — for administrators — the control to move
 * it. Transfer is deliberately its own action rather than a side effect of
 * editing, so changing what a Trigger does can never change whose permissions
 * it carries. Its main use is recovering a Watch whose creator left the team,
 * which pauses it until someone still on the team takes it over.
 */
export function ExecutionPrincipalBanner({
  principalLabel,
  status,
  error,
  members,
  canTransfer,
  onTransfer,
}: {
  principalLabel: string
  status?: 'unchecked' | 'valid' | 'invalid'
  error?: string
  members: TeamMember[]
  canTransfer: boolean
  onTransfer: (userId: string) => Promise<void>
}) {
  const [transferring, setTransferring] = useState(false)
  const eligible = useMemo(() => members.filter((member) => !member.removedAt), [members])

  return (
    <div
      className={clsx(
        'rounded-md border px-3 py-2 text-[11.5px]',
        status === 'invalid'
          ? 'border-error/40 bg-error/10 text-error'
          : 'border-zGray-800 bg-zGray-950 text-tertiary',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span>
          Runs as <span className="font-medium text-main">{principalLabel}</span>. Editing never
          changes this — execution always uses that member's own permissions.
        </span>
        {canTransfer && eligible.length > 0 && (
          <AppSelect
            value=""
            placeholder={transferring ? 'Transferring…' : 'Transfer'}
            disabled={transferring}
            triggerClassName="h-7 w-[150px] flex-shrink-0 border-zGray-800 px-2 text-[11.5px]"
            options={eligible.map((member) => ({
              value: member.id,
              label: member.name || member.email || member.id,
            }))}
            onValueChange={(nextUserId) => {
              if (!nextUserId) return
              setTransferring(true)
              void onTransfer(nextUserId).finally(() => setTransferring(false))
            }}
          />
        )}
      </div>
      {status === 'invalid' && (
        <span className="mt-1 block">
          {error ?? 'The execution principal is no longer authorized, so this is paused.'}
        </span>
      )}
    </div>
  )
}

export function Toggle({
  enabled,
  disabled = false,
  ariaLabel,
  onChange,
}: {
  enabled: boolean
  disabled?: boolean
  ariaLabel?: string
  onChange: (v: boolean) => void
}) {
  // Flex layout instead of absolute + translate — the latter combined with
  // some global CSS to leak `left: 18px` onto the thumb in this project's
  // Tailwind v3 setup, pushing the white knob outside the visible track.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel ?? (enabled ? 'Disable trigger' : 'Enable trigger')}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!enabled)
      }}
      className={clsx(
        'w-9 h-5 rounded-full transition-colors flex-shrink-0 flex items-center p-0.5',
        enabled ? 'bg-zViolet-500 justify-end' : 'bg-zGray-700 justify-start',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      title={enabled ? 'Disable' : 'Enable'}
    >
      <span className="block w-4 h-4 rounded-full bg-white" />
    </button>
  )
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  /** If the field wraps a single native control, pass its id so the label
   *  is properly associated (htmlFor). For composite controls (CronBuilder,
   *  TypePill row) omit this — the parent should pass `aria-labelledby` to
   *  the inner controls instead. */
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-secondary mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] text-tertiary mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

export function TypePill({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: typeof Clock
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex items-center gap-1.5 h-8 px-3 rounded-md border text-[12.5px] transition-colors',
        active
          ? 'border-zViolet-500 bg-zViolet-500/10 text-main'
          : 'border-zGray-800 text-secondary hover:text-main hover:border-zGray-700',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
      {label}
    </button>
  )
}

export function CopyableRow({
  label,
  value,
  hidden,
  copied,
  onCopy,
  rightAction,
}: {
  label: string
  value: string
  hidden?: boolean
  copied: boolean
  onCopy: () => void
  rightAction?: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[11.5px] text-tertiary mb-1">{label}</div>
      <div className="flex items-center gap-1">
        <code className="flex-1 truncate font-mono text-[11.5px] text-main bg-zGray-900 border border-zGray-800 rounded px-2 py-1">
          {hidden ? '•'.repeat(Math.min(value.length, 32)) : value}
        </code>
        {rightAction}
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
          className="w-6 h-6 rounded flex items-center justify-center text-tertiary hover:text-main"
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-zGreen-400" strokeWidth={1.8} />
          ) : (
            <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
          )}
        </button>
      </div>
    </div>
  )
}
