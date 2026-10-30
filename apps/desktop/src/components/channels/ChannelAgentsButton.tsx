import { Bot } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import { AgentPickRow, ChannelPopover } from './channelParts'
import { ROW, SECTION_LABEL, ownAgents } from './channelShared'

import type { ChannelAgent } from '../../api'

/**
 * The channel's agents. Only an agent's owner adds it: their word that everyone
 * here may talk to it. The channel's owner or the agent's owner can take it out.
 */
export function ChannelAgentsButton({
  teamId,
  channelId,
  channelOwnerId,
  viewerId,
  agents,
  onAgentsChange,
}: {
  teamId: string
  channelId: string
  channelOwnerId: string
  viewerId: string
  agents: ChannelAgent[]
  onAgentsChange: (agents: ChannelAgent[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inChannel = new Set(agents.map((agent) => agent.sessionId))
  const addable = open ? ownAgents(teamId, viewerId).filter((a) => !inChannel.has(a.sessionId)) : []

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      toast.apiError(failure, error)
    } finally {
      setBusy(false)
    }
  }
  const add = (sessionId: string) =>
    run(async () => {
      onAgentsChange((await api.agentAddChannelAgent(channelId, teamId, sessionId)).agents)
    }, t('Could not add the agent'))
  const remove = (sessionId: string) =>
    run(async () => {
      await api.agentRemoveChannelAgent(channelId, teamId, sessionId)
      onAgentsChange(agents.filter((agent) => agent.sessionId !== sessionId))
    }, t('Could not remove the agent'))

  return (
    <ChannelPopover
      open={open}
      onOpenChange={setOpen}
      title={t('Agents in this channel')}
      trigger={
        <button
          type="button"
          title={t('Agents in this channel')}
          className="titlebar-no-drag flex h-7 flex-shrink-0 items-center gap-2 rounded-md px-1.5 text-[12px] font-medium text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60"
        >
          {agents.length > 0 ? (
            <span className="flex -space-x-1">
              {agents.slice(0, 4).map((agent) => (
                <AgentAvatar
                  key={agent.sessionId}
                  agentId={agent.sessionId}
                  avatar={agent.avatar}
                  size={20}
                />
              ))}
            </span>
          ) : (
            <Bot className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {t('Agents')}
        </button>
      }
    >
      <div className="flex flex-col gap-1">
        {agents.length === 0 && (
          <div className="px-1 text-[12px] text-tertiary">{t('No agents here yet.')}</div>
        )}
        {agents.map((agent) => (
          <div key={agent.sessionId} className={ROW}>
            <AgentAvatar agentId={agent.sessionId} avatar={agent.avatar} size={20} />
            <span className="min-w-0 flex-1 truncate text-main">{agent.title}</span>
            <span className="px-1 text-[11px] text-tertiary">
              {agent.ownerId === viewerId ? t('Your agent') : t('A teammate’s agent')}
            </span>
            {(agent.ownerId === viewerId || channelOwnerId === viewerId) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void remove(agent.sessionId)}
              >
                {t('Remove')}
              </Button>
            )}
          </div>
        ))}
      </div>
      {addable.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className={SECTION_LABEL}>{t('Add your agents')}</div>
          {addable.map((agent) => (
            <AgentPickRow
              key={agent.sessionId}
              agent={agent}
              picked={false}
              onToggle={() => void add(agent.sessionId)}
            />
          ))}
        </div>
      )}
      <div className="px-1 text-[12px] leading-snug text-tertiary">
        {t(
          'Adding your agent lets everyone here talk to it. Anything that needs approval still waits for you in its session.',
        )}
      </div>
    </ChannelPopover>
  )
}
