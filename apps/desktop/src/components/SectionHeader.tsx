import type { ReactNode } from 'react'

/**
 * Heading for one band of a detail document: icon + title on the left, an
 * optional count or one-line explanation pushed to the right. Sections
 * themselves are plain `<section className="px-6 py-4 border-t …">` bands, so
 * the page reads as a continuous document rather than a grid of cards.
 */
export function SectionHeader({
  icon,
  title,
  hint,
}: {
  icon: ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h2 className="text-[13.5px] font-semibold text-main">{title}</h2>
      {hint && <span className="ml-auto text-[11.5px] text-tertiary">{hint}</span>}
    </div>
  )
}
