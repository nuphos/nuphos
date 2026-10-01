import { Collapsible } from '@base-ui/react/collapsible'
import clsx from 'clsx'
import { ChevronRight, Terminal } from 'lucide-react'

import { disclosureControlClass, LoadingText } from './partChrome'
import { shellsFromRuntimeState } from './shells'
import { trimDisplayBlock } from './toolPartUtils'

import type { ShellEntry } from './shells'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'

function ShellRow({ shell }: { shell: ShellEntry }) {
  const command = trimDisplayBlock(shell.command)
  const output = trimDisplayBlock(shell.output)
  const running = shell.status === 'running'
  const failed =
    !running && shell.exitCode !== null && shell.exitCode !== undefined && shell.exitCode !== 0

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
        {running ? (
          <LoadingText className="flex-shrink-0 text-[11px]">running</LoadingText>
        ) : (
          <span
            className={clsx('flex-shrink-0 text-[11px]', failed ? 'text-error' : 'text-tertiary')}
          >
            {failed ? `exit ${String(shell.exitCode)}` : 'exited'}
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="ml-1.5 mt-1.5 max-h-56 overflow-auto scrollbar-thin whitespace-pre-wrap break-words border-l-2 border-zGray-800 pl-3 font-mono text-[12px] leading-[1.55] text-secondary">
        {output || 'No output yet.'}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/**
 * Live shell activity for the current runtime snapshot — openab's terminal
 * embeds (Zed `_meta["terminal_output"]` convention) surfaced per tool.
 * Renders nothing once the snapshot holds no terminal-bearing tools.
 */
export function ShellsPanel({ snapshot }: { snapshot: RuntimeExecution | undefined }) {
  const shells = shellsFromRuntimeState(snapshot)

  if (shells.length === 0) return null

  return (
    <div className="space-y-1.5 text-[12.5px]">
      <div className="text-[11px] uppercase tracking-wider text-tertiary">
        {shells.length} {shells.length === 1 ? 'shell' : 'shells'}
      </div>
      <div className="space-y-1">
        {shells.map((shell) => (
          <ShellRow key={shell.id} shell={shell} />
        ))}
      </div>
    </div>
  )
}
