import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { useAdminName } from './useAdminName'

import type { ReactNode } from 'react'

export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[20px] font-semibold text-main">{title}</h1>
      <p className="mt-1 text-[13px] text-tertiary">{description}</p>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-medium text-secondary mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1.5 text-[12px] text-tertiary">{hint}</span>}
    </label>
  )
}

export function SubHeader({ title }: { title: string }) {
  return <h2 className="text-[15px] font-semibold text-main mb-3">{title}</h2>
}

/** A load that failed: what did not load, and the one way forward. Every section uses this. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-tertiary">
      {message}
      <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
        {t('Retry')}
      </Button>
    </p>
  )
}

/** Said under a control a member cannot change, naming who can; not hidden in a tooltip. */
export function AdminOnlyHint({ teamId }: { teamId: string }) {
  const admin = useAdminName(teamId)

  return (
    <p className="mt-2 text-[12px] text-tertiary">
      {admin
        ? t('Only {name} can change this.', { name: admin })
        : t('Only workspace administrators can change this')}
    </p>
  )
}
