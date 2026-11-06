import { t } from '../../i18n'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { runtimeTypingIn } from '../../lib/runtimeExecution'
import { AgentAvatar } from '../agent/AgentAvatar'

import type { ChannelAgent } from '../../api'

/**
 * iMessage-style dots for an agent in a turn this channel started or steered.
 * Each agent's bubble opens and closes in place, after a beat, so an agent
 * that reads the post and has nothing to say never flashes them.
 */
export function Typing({ agents, channelId }: { agents: ChannelAgent[]; channelId: string }) {
  const states = useAgentRuntimeStates()

  // Closed rows take no room: each open one brings its own gap.
  return (
    <div className="-mt-3">
      {agents.map((agent) => {
        const open = String(runtimeTypingIn(states.get(agent.sessionId), channelId))
        const transitionDelay = open === 'true' ? '800ms' : '0ms'

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
                <AgentAvatar agentId={agent.sessionId} avatar={agent.avatar} size={28} />
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
