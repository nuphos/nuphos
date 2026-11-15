import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { t } from '../../i18n'
import { formatElapsed } from '../agent/panel/voiceDictation'
import { Tooltip } from '../ui/tooltip'

import { showBotQuestion } from './useBotChatQuestions'
import { useBotWork, useTicking } from './useBotWork'

import type { BotWork, Step } from './botWork'
import type { RefObject } from 'react'

function stepText(step: Step): string {
  if (step.kind === 'command') return t('Running: {command}', { command: step.command })
  if (step.kind === 'tool') return t('Using {tool}', { tool: step.title })

  return t('Thinking…')
}

function askingText(work: BotWork & { kind: 'asking' }): string {
  if (!work.question) return t('Needs your input')
  if (work.count > 1)
    return t('Needs your input ({count}): {q}', { count: work.count, q: work.question })

  return t('Needs your input: {q}', { q: work.question })
}

function waitingText(work: BotWork & { kind: 'waiting' }): string {
  const names = work.kids.map((kid) => kid.conversation.title).join(', ')

  return work.kids.length === 1
    ? t('Waiting on 1 Task: {names}', { names })
    : t('Waiting on {count} Tasks: {names}', { count: work.kids.length, names })
}

/** The one line the pill says: what the Bot does, and why when it is not this chat. */
function workText(work: BotWork): string {
  if (work.kind === 'asking') return askingText(work)
  if (work.kind === 'waiting') return waitingText(work)
  if (work.kind === 'background') return t('Working in the background')
  if (work.reason === 'report' && work.step.kind === 'thinking')
    return t("Handling a Task's report")
  if (work.reason === 'other' && work.step.kind === 'thinking')
    return t('Working outside this chat')

  return stepText(work.step)
}

function pillClass(asking: boolean, pressable: boolean): string {
  return clsx(
    'titlebar-no-drag hidden h-[26px] max-w-[min(420px,100%)] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] leading-[18px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-line-focus @[120px]:inline-flex',
    asking ? 'bg-warning/[0.08] text-warning' : 'bg-state-hover text-tertiary',
    pressable && (asking ? 'hover:bg-warning/[0.12]' : 'hover:bg-state-selected'),
  )
}

/**
 * Beside the Bot's name in its chat's title bar, while the Bot or a Task under
 * it works: one line saying what it does and for how long, as its sidebar row
 * knows it. Nothing is drawn, and no room is kept, while the Bot rests.
 */
export function BotStatusPill({
  teamId,
  botId,
  channelId,
  chat,
  onOpenTask,
  onOpenLink,
}: {
  teamId: string
  /** The chat's Bot; a chat without one draws nothing. */
  botId: string | undefined
  channelId: string
  /** The chat's scroller, where an open question's card is found. */
  chat: RefObject<HTMLElement | null>
  /** Opens the Bot's Task page; absent for a viewer who may not open it. */
  onOpenTask?: (botId: string) => void
  onOpenLink?: (href: string) => boolean
}) {
  const { work, since } = useBotWork(teamId, botId, channelId)
  const now = useTicking(work !== null && since !== undefined)
  const words = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  const text = work ? workText(work) : ''

  // Only cut-off words get the tooltip, so it is measured as the words or the room change.
  useEffect(() => {
    const el = words.current

    if (!el) return
    const measure = () => setCut(el.scrollWidth > el.clientWidth)
    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(el)

    return () => observer.disconnect()
  }, [text])

  if (!work || !botId) return null
  const asking = work.kind === 'asking'
  const onClick = asking
    ? () => showBotQuestion(chat.current, teamId, work.id, onOpenLink)
    : onOpenTask && (() => onOpenTask(botId))
  const Pill = onClick ? 'button' : 'div'

  return (
    // Its own container, so the pill leaves altogether once under 120px remain.
    <div className="@container flex min-w-0 flex-1 items-center pl-0.5">
      <Tooltip
        content={text}
        side="bottom"
        align="start"
        delay={500}
        disabled={!cut}
        trigger={
          <Pill
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            role={onClick ? undefined : 'status'}
            className={pillClass(asking, onClick !== undefined)}
          />
        }
      >
        {asking ? (
          <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
        ) : (
          <Loader2 className="size-3 shrink-0 animate-spin" strokeWidth={2.25} aria-hidden />
        )}
        <span ref={words} className={clsx('min-w-0 truncate', asking && 'font-medium')}>
          {text}
        </span>
        {/* No run says when it started: no time rather than a wrong one. */}
        {since !== undefined && (
          <span className="shrink-0 tabular-nums opacity-70">{formatElapsed(now - since)}</span>
        )}
      </Tooltip>
    </div>
  )
}
