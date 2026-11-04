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
import { ChannelPopover } from './channelParts'
import { SECTION_LABEL, ownAgents } from './channelShared'

import type { Pickable } from '../agent/PersonFace'
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
  // Teammates and the viewer's own agents are picked alike: an agent is a teammate here.
  const [picked, setPicked] = useState<Pickable[]>([])
  const [busy, setBusy] = useState(false)
  const agents: Pickable[] = (open ? ownAgents(teamId, viewerId) : []).map((agent) => ({
    id: agent.sessionId,
    name: agent.title || t('Untitled agent'),
    email: '',
    agent: { avatar: agent.avatar, provider: agent.agentRuntime },
  }))

  useEffect(() => {
    if (!open || members) return
    api.atlasListTeamMembers(teamId).then(setMembers, () => setMembers([]))
  }, [open, members, teamId])

  const reset = () => {
    setTitle('')
    setPicked([])
  }
  const onlyAgent = picked.length === 1 && picked[0]!.agent ? picked[0] : undefined
  // Named after the agent, as a channel is named: never the agent's own name.
  const fallback = (onlyAgent?.name ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  const name = title.trim() || fallback

  const create = async () => {
    setBusy(true)
    try {
      const { sessionId } = await api.agentCreateChannel(teamId, name)

      markChannel(sessionId)
      const people = picked.filter((member) => !member.agent)

      if (people.length > 0)
        await api.agentInviteConversationParticipants(
          sessionId,
          teamId,
          people.map((person) => person.id),
        )
      for (const agent of picked.filter((member) => member.agent))
        await api.agentAddChannelAgent(sessionId, teamId, agent.id)
      setOpen(false)
      reset()
      onCreated(sessionId)
    } catch (error) {
      toast.apiError(t('Could not create the chat'), error)
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
      title={t('New chat')}
      trigger={
        <span
          role="button"
          tabIndex={0}
          aria-label={t('New chat')}
          title={t('New chat')}
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
            placeholder={fallback || t('e.g. launch-war-room')}
            className="text-[13px] text-main placeholder:text-tertiary"
          />
        </InputGroup>
      </div>
      <TeammatePicker
        members={members}
        invitable={[...(members ?? []).filter((member) => member.id !== viewerId), ...agents]}
        picked={picked}
        disabled={busy}
        onToggle={(member) =>
          setPicked((current) =>
            current.some((p) => p.id === member.id)
              ? current.filter((p) => p.id !== member.id)
              : [...current, member],
          )
        }
      />
      <div className="px-1 text-[12px] leading-snug text-tertiary">
        {t('Pick one agent and no name for a chat with just that agent.')}
      </div>
      <Button variant="neutral" size="sm" disabled={busy || !name} onClick={() => void create()}>
        {t('Create chat')}
      </Button>
    </ChannelPopover>
  )
}
