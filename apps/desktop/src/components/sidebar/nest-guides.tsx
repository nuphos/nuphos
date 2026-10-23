import { Fragment } from 'react'

import type { ReactNode } from 'react'

// Tree lines follow the icon centre in either sidebar density.
const NEST_INDENT = 16
const LINE = 'pointer-events-none absolute border-zGray-800/60'
// -bottom-0.5 spans the 2px gap between rows so the next row's line joins on.
const DOWN = `${LINE} -bottom-0.5 border-l`

/**
 * A chat row's clipped, indented body plus its tree lines. The lines sit
 * outside the clipped box so they can span the gap and join the next row.
 */
export function NestedRowBody({
  trail,
  expanded,
  comfortable = false,
  children,
}: {
  /** From nestItems: per ancestor level, whether that branch continues below. */
  trail: boolean[]
  /** This row's own children are showing, so a line drops from its icon. */
  expanded: boolean
  comfortable?: boolean
  children: ReactNode
}) {
  const own = trail.length - 1
  const x = (level: number) => ({ left: level * NEST_INDENT + (comfortable ? 23 : 19) })
  const centerY = comfortable ? 21 : 15
  const bottomY = comfortable ? 37 : 27

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
              style={{ ...x(level), height: centerY }}
            />
          )}
        </Fragment>
      ))}
      {expanded && (
        <span aria-hidden className={DOWN} style={{ ...x(trail.length), top: bottomY }} />
      )}
    </>
  )
}
