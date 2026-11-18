import { t } from '../../i18n'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { runtimeTurnActive, runtimeTypingIn } from '../../lib/runtimeExecution'
import { AgentAvatar } from '../agent/AgentAvatar'

import type { ChannelAgent } from '../../api'

/** Why an agent a post waits on is not answering yet, where it will answer on its own (#3308).
 *  Anything a person must fix is the couldn't-reply line's, which offers the fix. */
function waitLine(agent: ChannelAgent): string | null {
  const presence = agent.presence

  if (presence?.state === 'busy')
    return t('{name} is working outside this chat. It will reply when that’s done.', {
      name: agent.title,
    })
  if (presence?.state === 'offline' && presence.reason === 'computer_offline')
    return t('{name}’s computer is offline. It will reply when the computer is back.', {
      name: agent.title,
    })

  return null
}

/**
 * iMessage-style work dots for the private Bot, or a group agent replying here.
 * Each agent's bubble opens and closes in place, after a beat, so an agent
 * that reads the post and has nothing to say never flashes them.
 */
export function Typing({
  agents,
  channelId,
  botId,
  waiting = new Set(),
}: {
  agents: ChannelAgent[]
  channelId: string
  botId?: string
  /** The agents a person's post still waits on. */
  waiting?: ReadonlySet<string>
}) {
  const states = useAgentRuntimeStates()

  // Closed rows take no room: each open one brings its own gap.
  return (
    <div className="-mt-3">
      {agents.map((agent) => {
        const snapshot = states.get(agent.sessionId)
        const open = String(
          runtimeTypingIn(snapshot, channelId) ||
            (agent.sessionId === botId && runtimeTurnActive(snapshot)),
        )
        const transitionDelay = open === 'true' ? '800ms' : '0ms'
        const line = open !== 'true' && waiting.has(agent.sessionId) ? waitLine(agent) : null

        if (line)
          return (
            <div key={agent.sessionId} className="flex items-center gap-2.5 pt-3" role="status">
              <AgentAvatar
                agentId={agent.sessionId}
                avatar={agent.avatar}
                provider={agent.provider}
                size={28}
              />
              <span className="text-[12.5px] leading-[18px] text-tertiary">{line}</span>
            </div>
          )

        return (
          <div
            key={agent.sessionId}
            className="t-collapse"
            data-open={open}
            style={{ transitionDelay }}
            aria-hidden={open !== 'true'}
          >
            <div className="t-collapse-inner">
              <div
                className="t-panel-slide flex origin-bottom-left items-end gap-2.5 pt-3 [--panel-translate-y:8px]"
                data-open={open}
                style={{ transitionDelay }}
                role="status"
                aria-label={t('{name} is thinking', { name: agent.title })}
              >
                <AgentAvatar
                  agentId={agent.sessionId}
                  avatar={agent.avatar}
                  provider={agent.provider}
                  size={28}
                />
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-state-selected px-3.5 py-3 text-tertiary">
                  {[0, 160, 320].map((delay) => (
                    <span
                      key={delay}
                      className="t-typing-dot h-1.5 w-1.5 rounded-full bg-current"
                      style={{ animationDelay: `${String(delay)}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
