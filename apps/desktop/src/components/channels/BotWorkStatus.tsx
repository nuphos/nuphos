import { useState } from 'react'

import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { formatElapsed } from '../agent/panel/voiceDictation'

import { useBotWork, useTicking } from './useBotWork'

import type { BotWork, Step } from './botWork'
import type { ChannelAgent } from '../../api'

function stepText(step: Step): string {
  if (step.kind === 'command') return t('Running: {command}', { command: step.command })
  if (step.kind === 'tool') return t('Using {tool}', { tool: step.title })

  return t('Thinking…')
}

/** The one line the status says: what the Bot does, and why when it is not this chat. */
function workText(work: BotWork): string {
  if (work.kind === 'asking')
    return work.question ? t('Needs your input: {q}', { q: work.question }) : t('Needs your input')
  if (work.kind === 'waiting')
    return t('Waiting on {count} sub-agents:', { count: work.kids.length })
  if (work.kind === 'background') return t('Working in the background')
  if (work.reason === 'report' && work.step.kind === 'thinking')
    return t("Handling a sub-agent's report")
  if (work.reason === 'other' && work.step.kind === 'thinking')
    return t('Working outside this chat')

  return stepText(work.step)
}

/** All the row shows of a reading, so two equal readings compare equal. */
function workSays(work: BotWork | null): string {
  if (!work) return ''

  return JSON.stringify([
    workText(work),
    work.kids.map((kid) => [kid.conversation.sessionId, kid.conversation.title]),
  ])
}

/**
 * Under a Bot's chat, while the Bot or one of its sub-agents works: one line
 * saying what it is doing and for how long, as its sidebar row knows it. Not a
 * post: it folds away as soon as the Bot rests, and stands in for its typing dots.
 */
export function BotWorkStatus({
  teamId,
  channelId,
  agent,
  onOpenSession,
}: {
  teamId: string
  channelId: string
  agent: ChannelAgent
  /** Opens a sub-agent; absent for a viewer who does not own the Bot. */
  onOpenSession?: (sessionId: string) => void
}) {
  const { work: live, since } = useBotWork(teamId, agent.sessionId, channelId)
  const now = useTicking(live !== null)
  // The last reading stays while the row folds away, so it never empties first.
  // `live` is a new object every render, so it is kept by what it says, not by
  // identity: comparing objects would set state forever (React error #301).
  const [shown, setShown] = useState(() => ({ said: workSays(live), work: live }))
  const says = workSays(live)

  if (live && says !== shown.said) setShown({ said: says, work: live })
  const work = live ?? shown.work
  const open = String(live !== null)
  const text = work ? workText(work) : ''

  return (
    <div className="-mt-3 t-collapse" data-open={open} aria-hidden={open !== 'true'}>
      <div className="t-collapse-inner">
        <div
          className="t-panel-slide flex origin-bottom-left items-center gap-2.5 pt-3 [--panel-translate-y:8px]"
          data-open={open}
          role="status"
          aria-label={text || undefined}
        >
          <AgentAvatar
            agentId={agent.sessionId}
            avatar={agent.avatar}
            provider={agent.provider}
            size={28}
          />
          {work && (
            <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-tertiary">
              {/* Shimmers while the Bot works, as its name does in the sidebar. */}
              <span className="t-shimmer min-w-0 max-w-full truncate align-top" data-text={text}>
                {text}
              </span>
              {work.kind === 'waiting' && (
                <span className="flex min-w-0 items-center gap-1 truncate">
                  {work.kids.map((kid, index) => (
                    <span
                      key={kid.conversation.sessionId}
                      className="flex min-w-0 items-center gap-1"
                    >
                      {index > 0 && <span aria-hidden>·</span>}
                      {onOpenSession ? (
                        <button
                          type="button"
                          onClick={() => onOpenSession(kid.conversation.sessionId)}
                          className="truncate text-secondary hover:text-main hover:underline"
                        >
                          {kid.conversation.title}
                        </button>
                      ) : (
                        <span className="truncate text-secondary">{kid.conversation.title}</span>
                      )}
                    </span>
                  ))}
                </span>
              )}
              {/* No run says when it started: no time rather than a wrong one. */}
              {since !== undefined && (
                <span className="shrink-0 tabular-nums text-[12px]">
                  {formatElapsed(now - since)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
