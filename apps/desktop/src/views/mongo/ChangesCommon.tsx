import { Loader2 } from 'lucide-react'

import type { DatabaseChangeRequest, TeamMember } from '../../types'

export function StatusBadge({ status }: { status: DatabaseChangeRequest['status'] }) {
  const tone =
    status === 'succeeded'
      ? 'bg-success/10 text-success'
      : status === 'failed' || status === 'rejected'
        ? 'bg-error/10 text-error'
        : status === 'approved'
          ? 'bg-warning/10 text-warning'
          : 'bg-zGray-800 text-secondary'

  return (
    <span className={`rounded-full px-2 py-0.5 text-[9.5px] ${tone}`}>
      {status.replaceAll('_', ' ')}
    </span>
  )
}

export function ActionButton({
  label,
  disabled,
  onClick,
  tone = 'default',
  icon,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  tone?: 'default' | 'success' | 'warning' | 'error'
  icon?: React.ReactNode
}) {
  const cls =
    tone === 'success'
      ? 'border-success/35 text-success'
      : tone === 'warning'
        ? 'border-warning/35 text-warning'
        : tone === 'error'
          ? 'border-error/35 text-error'
          : 'border-zGray-700 text-secondary'

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10.5px] disabled:opacity-50 ${cls}`}
    >
      {icon}
      {label}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="block">
      <div className="mb-1 text-[11.5px] text-secondary">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[10px] text-tertiary">{hint}</div>}
    </div>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-tertiary">
      {children}
    </div>
  )
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zGray-800 p-3">
      <div className="text-[10px] text-tertiary">{label}</div>
      <div className="mt-1 text-[12px] text-secondary">{value}</div>
    </div>
  )
}

export function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-zGray-800 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary">{title}</div>
      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-secondary">{text}</p>
    </div>
  )
}

export function CenteredLoader() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
    </div>
  )
}

export function ExecutorsPicker({
  members,
  currentUserId,
  executors,
  onChange,
}: {
  members: TeamMember[]
  currentUserId: string
  executors: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-md border border-zGray-800 p-2">
      {members.map((member) => {
        const requester = member.id === currentUserId
        const checked = requester || executors.includes(member.id)

        return (
          <label
            key={member.id}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-[11.5px] text-secondary hover:bg-zGray-800/50"
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={requester}
              onChange={() =>
                onChange(
                  checked ? executors.filter((id) => id !== member.id) : [...executors, member.id],
                )
              }
            />
            <span className="truncate">{member.name || member.username || member.email}</span>
            {requester && <span className="ml-auto text-[9px] text-tertiary">requester</span>}
          </label>
        )
      })}
    </div>
  )
}
