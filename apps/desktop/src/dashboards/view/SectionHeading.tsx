/** A list section's title, with a line on who can see what is in it. */
export function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="text-[13px] font-medium text-main">{title}</h2>
      <span className="text-[12px] text-tertiary">{hint}</span>
    </div>
  )
}
