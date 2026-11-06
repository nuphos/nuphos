import { CircleCheck } from 'lucide-react'
import { Fragment } from 'react'

import { t } from '../../i18n'
import { openChatSummarySubAgents } from '../../lib/chatSummaryPanel'

import type { Item } from './types'
import type { ReactNode } from 'react'

// Tree lines follow the icon centre in compact density. A comfortable row's
// face sits close beside its status dot, so there they run down the dot column,
// from a parent's dot to its threads' dots.
const NEST_INDENT = 16
const COMFORTABLE_INDENT = 19
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
  const indent = comfortable ? COMFORTABLE_INDENT : NEST_INDENT
  const x = (level: number) => ({ left: level * indent + (comfortable ? 9 : 19) })
  const centerY = comfortable ? 32 : 15
  const bottomY = comfortable ? 38 : 27

  return (
    <>
      <div
        className="t-collapse-inner t-stagger-line"
        style={trail.length ? { paddingLeft: trail.length * indent } : undefined}
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
              className={`${LINE} top-0 rounded-bl-[6px] border-b border-l`}
              style={{ ...x(level), height: centerY, width: comfortable ? 14 : 6 }}
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

/** How the row names its done count, for screen readers and the tooltip. */
function finishedThreadsLabel(n: number): string {
  return n === 1 ? t('1 sub-agent done') : t('{n} sub-agents done', { n })
}

/**
 * Sub-agents that finished with nothing left to show, as one quiet count on
 * their parent row, like the merged badge. The tooltip names each of them.
 * The click also reaches the row, which opens the parent chat, and opens its
 * summary panel on the Done sub-agents. A click that opens the chat in a new
 * tab leaves this window's panel alone.
 */
export function FinishedThreadsBadge({ threads }: { threads: Item[] }) {
  const n = threads.length
  const parentKey = threads[0]?.parentKey

  return (
    <span
      onClick={(event) => {
        const newTab = event.metaKey || event.ctrlKey

        if (parentKey && !newTab) {
          openChatSummarySubAgents('done', parentKey.slice('agent-session:'.length))
        }
      }}
      title={[finishedThreadsLabel(n), ...threads.map((thread) => thread.label)].join('\n')}
      className="inline-flex items-center gap-1 text-[11px] text-tertiary"
    >
      <CircleCheck aria-hidden className="size-3 shrink-0" />
      <span aria-hidden>{n === 1 ? t('1 done') : t('{n} done', { n })}</span>
      <span className="sr-only">{finishedThreadsLabel(n)}</span>
    </span>
  )
}
