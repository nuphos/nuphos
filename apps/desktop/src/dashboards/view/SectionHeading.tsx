import clsx from 'clsx'

/**
 * A list section's title, with a line on who can see what is in it. The title
 * stays on one line and the hint wraps below it in a narrow pane. `inset` lines
 * the title up with a table's column text.
 */
export function SectionHeading({
  title,
  hint,
  inset = false,
}: {
  title: string
  hint: string
  inset?: boolean
}) {
  return (
    <div className={clsx('mb-2 flex flex-wrap items-baseline gap-x-2', inset && 'px-2')}>
      <h2 className="whitespace-nowrap text-[13px] font-medium text-main">{title}</h2>
      <span className="text-[12px] text-tertiary">{hint}</span>
    </div>
  )
}
