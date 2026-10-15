/**
 * The preview beside a hovered rail tick: the prompt, the start of the reply,
 * and a click target that jumps there. It stays mounted while the pointer
 * moves between ticks and glides to the new one instead of reopening.
 */
export function TurnRailCard({
  title,
  preview,
  top,
  width,
  onJump,
}: {
  title: string
  preview: string
  top: number
  width: number
  onJump: () => void
}) {
  return (
    // The right padding bridges the gap to the rail, so the pointer can cross
    // onto the card without leaving the hover area.
    // aria-hidden: the tick's label already names the turn, and the card is pointer-only.
    // It glides with transform, so moving between ticks never lays it out again.
    <div
      aria-hidden
      style={{ transform: `translateY(${String(top)}px)` }}
      className="absolute right-full top-0 pr-1 motion-safe:transition-transform motion-safe:duration-150 motion-safe:[transition-timing-function:var(--ease-smooth-out)]"
    >
      <div className="-translate-y-1/2">
        <button
          type="button"
          tabIndex={-1}
          onClick={onJump}
          style={{ width, transformOrigin: 'right center' }}
          className="t-dropdown is-open surface-raised block rounded-xl bg-elevated p-2.5 text-left outline-none"
        >
          <span className="block truncate text-[13px] font-semibold leading-5 text-main">
            {title}
          </span>
          {preview && (
            <span className="mt-0.5 line-clamp-3 text-[12px] leading-5 text-tertiary">
              {preview}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
