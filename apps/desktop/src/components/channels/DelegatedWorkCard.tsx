import { clsx } from 'clsx'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../i18n'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { AgentProviderIcon } from '../agent/panel/icons'
import { StatusLabel } from '../agent/panel/ThreadBadge'

import { firstSentence, taskSaid, taskStatus } from './delegatedWork'

import type { AgentConversation } from '../../api'
import type { ThreadStatus } from '../agent/panel/threadStatus'
import type { ReactNode } from 'react'

const SHOWN = 5
const LINK = 'flex items-center gap-1 hover:text-main hover:underline'
// What a row or the card offers to do, as its text reads.
const ACTION = `${LINK} text-[12.5px] font-medium text-main`

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium leading-4 text-secondary">{label}</div>
      <div className="line-clamp-4 break-words text-[12.5px] leading-5 text-main">{children}</div>
    </div>
  )
}

function TaskRow({
  task,
  status,
  open,
  onToggle,
  onOpenTask,
}: {
  task: AgentConversation
  status: ThreadStatus
  open: boolean
  onToggle: () => void
  onOpenTask: (sessionId: string) => void
}) {
  // Only a Task that ended on its own surely said its result last: while it runs
  // that may be a follow-up the Bot sent it, and a stopped Task may have been cut
  // off mid-sentence. Either way the line stays empty.
  const said = status === 'done' ? taskSaid(task) : ''
  const line = firstSentence(said)

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
      >
        <AgentProviderIcon
          provider={task.agentRuntime}
          aria-hidden
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-5 text-main">
              {task.title}
            </span>
            <StatusLabel status={status} pending={false} />
            <ChevronRight
              aria-hidden
              className={clsx(
                'size-3.5 shrink-0 text-tertiary transition-transform duration-150 motion-reduce:transition-none',
                open && 'rotate-90',
              )}
            />
          </span>
          {line && (
            <span className="block truncate text-[12.5px] leading-5 text-secondary">{line}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 pb-2 pl-[1.875rem] pr-1.5 pt-1.5">
          {task.firstMessage && <Detail label={t('Handed over')}>{task.firstMessage}</Detail>}
          {said && <Detail label={t('Result')}>{said}</Detail>}
          <button
            type="button"
            onClick={() => onOpenTask(task.sessionId)}
            className={clsx(ACTION, 'self-start')}
          >
            {t('Open Task')}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * Under a Bot's last message of a turn: the Tasks it started in that turn, each
 * with its state and, once it has finished, one line of its result. A row opens to what was
 * handed over and what came back; the steps stay in the Task itself.
 */
export function DelegatedWorkCard({
  tasks,
  onOpenTask,
  onOpenRecord,
}: {
  tasks: AgentConversation[]
  onOpenTask: (sessionId: string) => void
  /** Opens the Bot's own Task, the full record; absent for a viewer who cannot open it. */
  onOpenRecord?: () => void
}) {
  const states = useAgentRuntimeStates()
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const status = (task: AgentConversation) => taskStatus(task, states.get(task.sessionId))
  const done = tasks.filter((task) => status(task) === 'done').length

  return (
    // Under the bubbles: past the face and its gap, no wider than a post.
    <div className="flex w-full gap-2.5">
      <div className="w-7 shrink-0" />
      <section className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-0.5 rounded-[14px] bg-surface-raised px-2 py-2.5 shadow-[0_0_0_1px_rgb(var(--color-line-control)),0_1px_2px_rgba(0,0,0,0.04)]">
        <header className="flex items-center gap-2 px-1.5 pb-1 text-[12px] leading-4">
          <h3 className="font-semibold text-main">{t('Delegated work')}</h3>
          <span className="rounded bg-state-selected px-1.5 text-[11px] tabular-nums text-secondary">
            {tasks.length}
          </span>
          <span className="ml-auto tabular-nums text-tertiary">
            {t('{done} of {count} done', { done, count: tasks.length })}
          </span>
        </header>
        <ul className="flex flex-col">
          {(all ? tasks : tasks.slice(0, SHOWN)).map((task) => (
            <TaskRow
              key={task.sessionId}
              task={task}
              status={status(task)}
              open={open === task.sessionId}
              onToggle={() => setOpen(open === task.sessionId ? null : task.sessionId)}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
        <div className="flex flex-col gap-1.5 pl-[1.875rem] pt-1 text-secondary empty:hidden">
          {!all && tasks.length > SHOWN && (
            <button type="button" onClick={() => setAll(true)} className={clsx(ACTION, 'w-full')}>
              {t('Show all {count}', { count: tasks.length })}
            </button>
          )}
          {onOpenRecord && (
            <button
              type="button"
              onClick={onOpenRecord}
              className={clsx(LINK, 'self-start text-[12px]')}
            >
              {t('Full record in the Task view')}
              <ArrowUpRight aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
