import { Hash, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { TeammatePicker } from '../agent/TeammatePicker'
import { Button } from '../ui/button'
import { InputGroup, InputGroupInput } from '../ui/input-group'
import { toast } from '../ui/toast'

import { markChannel } from './channelKind'
import { AgentPickRow, ChannelPopover } from './channelParts'
import { SECTION_LABEL, ownAgents } from './channelShared'

import type { TeamMember } from '../../types'

/**
 * The sidebar's "+" for a new channel. One agent and no name makes a channel
 * with just that agent, named after it.
 */
export function NewChannelButton({
  teamId,
  onCreated,
}: {
  teamId: string
  onCreated: (sessionId: string) => void
}) {
  const viewer = useCurrentUser()
  const viewerId = viewer?.id ?? ''
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [people, setPeople] = useState<TeamMember[]>([])
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const agents = open ? ownAgents(teamId, viewerId) : []

  useEffect(() => {
    if (!open || members) return
    api.atlasListTeamMembers(teamId).then(setMembers, () => setMembers([]))
  }, [open, members, teamId])

  const reset = () => {
    setTitle('')
    setPeople([])
    setAgentIds([])
  }
  const onlyAgent =
    agentIds.length === 1 ? agents.find((agent) => agent.sessionId === agentIds[0]) : undefined
  const name = title.trim() || onlyAgent?.title || ''

  const create = async () => {
    setBusy(true)
    try {
      const { sessionId } = await api.agentCreateChannel(teamId, name)

      markChannel(sessionId)
      if (people.length > 0)
        await api.agentInviteConversationParticipants(
          sessionId,
          teamId,
          people.map((person) => person.id),
          'reply',
        )
      for (const agentId of agentIds) await api.agentAddChannelAgent(sessionId, teamId, agentId)
      setOpen(false)
      reset()
      onCreated(sessionId)
    } catch (error) {
      toast.apiError(t('Could not create the channel'), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ChannelPopover
      open={open}
      onOpenChange={setOpen}
      align="start"
      nativeButton={false}
      title={t('New channel')}
      trigger={
        <span
          role="button"
          tabIndex={0}
          aria-label={t('New channel')}
          title={t('New channel')}
          onPointerDown={(event) => event.stopPropagation()}
          className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-tertiary hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        <div className={SECTION_LABEL}>{t('Name')}</div>
        <InputGroup className="flex h-8 items-center gap-1.5 rounded-lg border border-zGray-800/60 px-2">
          <Hash className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2} />
          <InputGroupInput
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={onlyAgent?.title || t('e.g. launch-war-room')}
            className="text-[13px] text-main placeholder:text-tertiary"
          />
        </InputGroup>
      </div>
      <TeammatePicker
        members={members}
        invitable={(members ?? []).filter((member) => member.id !== viewerId)}
        picked={people}
        disabled={busy}
        onToggle={(member) =>
          setPeople((current) =>
            current.some((p) => p.id === member.id)
              ? current.filter((p) => p.id !== member.id)
              : [...current, member],
          )
        }
      />
      {agents.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className={SECTION_LABEL}>{t('Your agents')}</div>
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {agents.map((agent) => (
              <AgentPickRow
                key={agent.sessionId}
                agent={agent}
                picked={agentIds.includes(agent.sessionId)}
                onToggle={() =>
                  setAgentIds((current) =>
                    current.includes(agent.sessionId)
                      ? current.filter((id) => id !== agent.sessionId)
                      : [...current, agent.sessionId],
                  )
                }
              />
            ))}
          </div>
        </div>
      )}
      <div className="px-1 text-[12px] leading-snug text-tertiary">
        {t('Pick one agent and no name for a channel with just that agent.')}
      </div>
      <Button variant="neutral" size="sm" disabled={busy || !name} onClick={() => void create()}>
        {t('Create channel')}
      </Button>
    </ChannelPopover>
  )
}
