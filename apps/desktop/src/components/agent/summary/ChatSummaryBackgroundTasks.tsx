import { Collapsible } from '@base-ui/react/collapsible'
import clsx from 'clsx'
import { ChevronRight, Code, Layers } from 'lucide-react'

import { t } from '../../../i18n'
import { disclosureControlClass, LoadingText } from '../panel/partChrome'
import { trimDisplayBlock } from '../panel/toolPartUtils'

import { SummarySection } from './ChatSummaryRows'

import type { ShellEntry } from '../panel/shells'

/** Says what the row is before what it runs, so it never reads as a bare command. */
function KindNote({ task }: { task?: boolean }) {
  return (
    <span className="flex flex-shrink-0 items-center gap-1.5 text-[11px] text-tertiary">
      {task ? t('Task') : t('Command')}
      <span aria-hidden>·</span>
      <LoadingText className="text-[11px]">{t('running')}</LoadingText>
    </span>
  )
}

function TaskRow({ shell }: { shell: ShellEntry }) {
  return (
    <div
      className="flex h-7 min-w-0 items-center gap-3 text-[13px] text-main"
      title={shell.command}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">
        <Layers className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{shell.command}</span>
      <KindNote task />
    </div>
  )
}

/** A background command: expands to its latest output. */
function CommandRow({ shell }: { shell: ShellEntry }) {
  const command = trimDisplayBlock(shell.command)
  const output = trimDisplayBlock(shell.output)

  return (
    <Collapsible.Root>
      <Collapsible.Trigger
        className={clsx(
          disclosureControlClass,
          'group flex h-7 w-full min-w-0 items-center gap-3 text-left text-[13px] text-main',
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-tertiary">
          <Code className="size-3.5 group-hover:opacity-0 group-focus-visible:opacity-0" />
          <ChevronRight
            className="absolute size-3.5 opacity-0 transition-transform group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[panel-open]:rotate-90"
            strokeWidth={1.8}
          />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          {command || shell.terminalId}
        </span>
        <KindNote />
      </Collapsible.Trigger>
      <Collapsible.Panel className="t-acc-collapsible">
        <div className="mb-1 ml-2 mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words border-l-2 border-zGray-800 pl-3 font-mono text-[12px] leading-[1.55] text-secondary scrollbar-thin selectable">
          {output || t('No output yet.')}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/**
 * Commands and sub-agents the agent left running in its own runtime after its
 * turn: never on the user's device, and not the dock's local terminals.
 */
export function BackgroundTasksSection({ shells }: { shells: ShellEntry[] }) {
  return (
    <SummarySection
      title={t('Background tasks')}
      header={
        <p className="pt-0.5 text-[12px] leading-4 text-tertiary">
          {t('Commands and sub-agents the agent is running in its own runtime.')}
        </p>
      }
    >
      <div className="flex max-h-72 flex-col gap-0.5 overflow-auto scrollbar-thin">
        {shells.map((shell) =>
          shell.task ? (
            <TaskRow key={shell.id} shell={shell} />
          ) : (
            <CommandRow key={shell.id} shell={shell} />
          ),
        )}
      </div>
    </SummarySection>
  )
}
