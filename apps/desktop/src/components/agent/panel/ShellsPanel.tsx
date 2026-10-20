import { Collapsible } from '@base-ui/react/collapsible'
import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { ChevronRight, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { disclosureControlClass, LoadingText } from './partChrome'
import { shellsFromRuntimeState } from './shells'
import { trimDisplayBlock } from './toolPartUtils'

import type { ShellEntry } from './shells'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'

function ShellRow({ shell }: { shell: ShellEntry }) {
  const command = trimDisplayBlock(shell.command)
  const output = trimDisplayBlock(shell.output)

  return (
    <Collapsible.Root>
      <Collapsible.Trigger
        className={clsx(
          disclosureControlClass,
          'group flex w-full min-w-0 items-center gap-1.5 text-left text-tertiary hover:text-secondary',
        )}
      >
        <ChevronRight
          className="h-3.5 w-3.5 flex-shrink-0 transition-transform group-data-[panel-open]:rotate-90"
          strokeWidth={1.8}
        />
        <Terminal className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-main">
          {command || shell.terminalId}
        </span>
        <LoadingText className="flex-shrink-0 text-[11px]">running</LoadingText>
      </Collapsible.Trigger>
      <Collapsible.Panel className="ml-1.5 mt-1.5 whitespace-pre-wrap break-words border-l-2 border-zGray-800 pl-3 font-mono text-[12px] leading-[1.55] text-secondary">
        {output || 'No output yet.'}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/**
 * Shells still running in the current runtime snapshot — openab's terminal
 * embeds (Zed `_meta["terminal_output"]` convention) surfaced per tool.
 * A chip in the composer's single-row toolbar, so it adds no height and the
 * input never moves; it rises in while shells run, fades out after the last
 * one ends, and opens them in a popover.
 */
export function ShellsPanel({ snapshot }: { snapshot: RuntimeExecution | undefined }) {
  const shells = shellsFromRuntimeState(snapshot)
  const shown = shells.length > 0
  // Kept mounted, with its last count, until its fade-out has played.
  const [mounted, setMounted] = useState(shown)
  const [count, setCount] = useState(shells.length)
  const [open, setOpen] = useState(false)

  if (shown && !mounted) setMounted(true)
  if (shown && count !== shells.length) setCount(shells.length)
  if (!shown && open) setOpen(false)

  useEffect(() => {
    if (shown) return
    const closeMs = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--toast-close'),
    )
    const timer = setTimeout(() => setMounted(false), closeMs || 0)

    return () => clearTimeout(timer)
  }, [shown])

  const label = String(count)
  const title = `${label} running ${count === 1 ? 'shell' : 'shells'}`

  if (!mounted) return null

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        inert={!shown}
        title={title}
        aria-label={title}
        className={clsx(
          't-toast flex h-7 flex-shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] tabular-nums text-secondary [--toast-distance:var(--distance-micro)] [--toast-scale:var(--scale-small)] hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main',
          shown && 'is-open',
        )}
      >
        <Terminal className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
        <span className="t-shimmer" data-text={label}>
          {label}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} className="z-[1000]">
          <Popover.Popup
            data-origin="bottom-right"
            className={(state) =>
              clsx(
                't-dropdown w-[min(560px,calc(100vw-48px))] rounded-xl border border-zGray-800/60 bg-main p-2 text-[12.5px] shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                state.open && 'is-open',
                state.transitionStatus === 'ending' && 'is-closing',
              )
            }
          >
            <div className="max-h-72 space-y-1 overflow-auto scrollbar-thin">
              {shells.map((shell) => (
                <ShellRow key={shell.id} shell={shell} />
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
