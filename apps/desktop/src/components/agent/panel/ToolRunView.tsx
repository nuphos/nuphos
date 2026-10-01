import clsx from 'clsx'
import { ChevronRight, Terminal, X } from 'lucide-react'
import { useState } from 'react'

import { disclosureControlClass, LoadingText, ToolElapsedBadge } from './partChrome'
import { getToolLabel, isCommandTool } from './toolPartUtils'

import type { ToolPart } from './parts'
import type { ReactNode } from 'react'

export type ToolRunItem = {
  index: number
  node: ReactNode
}

/**
 * A run of consecutive tool calls, shown as one activity line: what the agent
 * is doing right now (the latest call), how many calls the run holds, and
 * whether any failed. Opening the line lists every call and the thinking
 * between them in order, each call with its own details. A call waiting for
 * approval opens the run by itself so its actions are never hidden. Same chrome as a single tool line — disclosure
 * chevron trailing, shown on hover — so the two read as one family.
 */
export function ToolRunView({
  parts,
  now,
  items,
}: {
  parts: ToolPart[]
  now: number
  /** One mounted tree in wire order; folding only hides it. */
  items: ToolRunItem[]
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const latest = parts[parts.length - 1]
  const needsAttention = latest.state === 'approval-requested'
  // A manual fold must not outlive the approval it was made under: each new
  // request clears the override so it opens the run like the first one did.
  const [attentionFor, setAttentionFor] = useState<string | null>(null)

  if (needsAttention && attentionFor !== latest.toolCallId) {
    setAttentionFor(latest.toolCallId)
    setUserOpen(null)
  }
  const open = userOpen ?? needsAttention
  const count = parts.length
  const done = latest.state === 'output-available' || latest.state === 'output-error'
  const errored = latest.state === 'output-error'
  const failed = parts.filter((part) => part.state === 'output-error').length
  const label = getToolLabel(latest)
  const commandTool = isCommandTool(latest)
  const toggle = () => setUserOpen(!open)

  return (
    <div className="text-[12.5px]">
      <button
        type="button"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          toggle()
        }}
        onClick={(event) => {
          if (event.detail !== 0) return
          toggle()
        }}
        aria-expanded={open}
        className={clsx(
          disclosureControlClass,
          'group inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-tertiary transition-colors hover:text-secondary',
        )}
      >
        {/* Keyed on the call so a new call fades in instead of the text just
            changing under the cursor. */}
        <span
          key={latest.toolCallId}
          className="t-tool-run-latest inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden"
        >
          {!done ? (
            <>
              {commandTool && <Terminal className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
              <LoadingText className="min-w-0 truncate text-left">{label}</LoadingText>
            </>
          ) : (
            <>
              {errored ? (
                <X className="h-3.5 w-3.5 flex-shrink-0 text-error" strokeWidth={2.2} />
              ) : (
                commandTool && <Terminal className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
              )}
              <span className="min-w-0 truncate text-left">{label}</span>
            </>
          )}
          <ToolElapsedBadge part={latest} now={now} />
        </span>
        {count > 1 && (
          <span className="flex-shrink-0 text-tertiary/70">· {String(count)} calls</span>
        )}
        {failed > 0 && !errored && (
          <span className="flex-shrink-0 text-error/80">· {String(failed)} failed</span>
        )}
        <ChevronRight
          className={clsx(
            'h-3.5 w-3.5 flex-shrink-0 transition-all',
            open ? 'rotate-90 opacity-60' : 'opacity-0 group-hover:opacity-60',
          )}
          strokeWidth={1.8}
        />
      </button>
      <div
        className={clsx(
          'ml-1.5 mt-2 space-y-2 border-l-2 border-zGray-800 pl-3',
          !open && 'hidden',
        )}
        inert={!open}
        aria-hidden={!open}
      >
        {items.map((item) => (
          <div key={item.index}>{item.node}</div>
        ))}
      </div>
    </div>
  )
}
