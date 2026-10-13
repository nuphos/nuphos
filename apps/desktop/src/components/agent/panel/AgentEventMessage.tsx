import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { toAbsoluteAtlasUrl } from '../../../lib/webBaseUrl'
import { Avatar } from '../../Avatar'
import { CloudLogo } from '../../CloudLogo'

import { AgentProviderIcon } from './icons'
import { MessageResponse } from '../MessageResponse'

import { Rule } from './TimelineEventLine'

import type { AgentMessageMetadata } from '../../../api/agent-types'
import type { ReactNode } from 'react'

/** A message another session or a linked resource delivered: written for the
 *  agent, so it sits in the timeline as one line and expands to the full text. */
export function AgentEventMessage({
  metadata,
  text,
  teamId,
  onOpenNuphosLink,
  renderLink,
}: {
  metadata: AgentMessageMetadata
  text: string
  teamId?: string
  onOpenNuphosLink?: (href: string) => boolean
  renderLink?: (href: string, children: ReactNode) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const { displayName } = metadata.sender
  const resourceProvider = (['github', 'linear', 'slack', 'discord'] as const).find(
    (provider) => provider === metadata.sender.id.toLowerCase(),
  )
  const sessionUrl =
    teamId && metadata.sourceSessionId
      ? toAbsoluteAtlasUrl(`/teams/${teamId}/agent/${metadata.sourceSessionId}`)
      : null

  return (
    <div>
      <Rule title={new Date(metadata.sentAt).toLocaleString()}>
        {metadata.source === 'agent.thread' && metadata.sender.agentRuntime ? (
          <AgentProviderIcon
            provider={metadata.sender.agentRuntime}
            className="h-3.5 w-3.5 shrink-0"
          />
        ) : metadata.source === 'agent.resource' && resourceProvider ? (
          <CloudLogo provider={resourceProvider} size={14} />
        ) : (
          <Avatar name={displayName} size={14} className="shrink-0 rounded-full" />
        )}
        {sessionUrl && onOpenNuphosLink ? (
          <button
            type="button"
            onClick={() => onOpenNuphosLink(sessionUrl)}
            className="min-w-0 truncate font-medium text-secondary hover:underline"
          >
            {displayName}
          </button>
        ) : (
          <span className="min-w-0 truncate font-medium text-secondary">{displayName}</span>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 max-w-[50vw] items-center gap-1 hover:text-secondary"
        >
          <span className="truncate">{text.split('\n')[0]}</span>
          <ChevronRight
            className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </button>
      </Rule>
      {open && (
        <div className="mt-2 rounded-lg border border-border/60 px-3.5 py-2 text-[13px] break-words">
          <MessageResponse
            className="[&_p]:whitespace-pre-wrap [&_li]:whitespace-pre-wrap"
            renderLink={renderLink}
            onLinkClick={onOpenNuphosLink}
          >
            {text}
          </MessageResponse>
        </div>
      )}
    </div>
  )
}
