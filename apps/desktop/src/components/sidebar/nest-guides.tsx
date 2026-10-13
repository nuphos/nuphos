import { Fragment } from 'react'

import type { ReactNode } from 'react'

// Tree lines for a nested chat row. Every row is 30px tall with its 16px icon
// centred 16px from its own left edge; nested rows indent NEST_INDENT per level.
const NEST_INDENT = 16
const ICON_CENTER_X = 16
const ICON_CENTER_Y = 15
const ICON_BOTTOM_Y = 24
const LINE = 'pointer-events-none absolute border-zGray-800/60'
// -bottom-0.5 spans the 2px gap between rows so the next row's line joins on.
const DOWN = `${LINE} -bottom-0.5 border-l`

const x = (level: number) => ({ left: level * NEST_INDENT + ICON_CENTER_X })

/**
 * A chat row's clipped, indented body plus its tree lines. The lines sit
 * outside the clipped box so they can span the gap and join the next row.
 */
export function NestedRowBody({
  trail,
  expanded,
  children,
}: {
  /** From nestItems: per ancestor level, whether that branch continues below. */
  trail: boolean[]
  /** This row's own children are showing, so a line drops from its icon. */
  expanded: boolean
  children: ReactNode
}) {
  const own = trail.length - 1

  return (
    <>
      <div
        className="t-collapse-inner t-stagger-line"
        style={trail.length ? { paddingLeft: trail.length * NEST_INDENT } : undefined}
      >
        {children}
      </div>
      {trail.map((continues, level) => (
        <Fragment key={level}>
          {continues && <span aria-hidden className={`${DOWN} top-0`} style={x(level)} />}
          {level === own && (
            // The turn into this row's icon.
            <span
              aria-hidden
              className={`${LINE} top-0 w-[6px] rounded-bl-[6px] border-b border-l`}
              style={{ ...x(level), height: ICON_CENTER_Y }}
            />
          )}
        </Fragment>
      ))}
      {expanded && (
        <span aria-hidden className={DOWN} style={{ ...x(trail.length), top: ICON_BOTTOM_Y }} />
      )}
    </>
  )
}
