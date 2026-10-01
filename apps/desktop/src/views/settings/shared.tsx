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
