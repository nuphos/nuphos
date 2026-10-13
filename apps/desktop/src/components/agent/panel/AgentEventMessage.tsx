import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { toAbsoluteAtlasUrl } from '../../../lib/webBaseUrl'
import { Avatar } from '../../Avatar'
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
  const sessionUrl =
    teamId && metadata.sourceSessionId
      ? toAbsoluteAtlasUrl(`/teams/${teamId}/agent/${metadata.sourceSessionId}`)
      : null

  return (
    <div>
      <Rule title={new Date(metadata.sentAt).toLocaleString()}>
        <Avatar name={displayName} size={14} className="shrink-0 rounded-full" />
        {sessionUrl && onOpenNuphosLink ? (
          <button
            type="button"
            onClick={() => onOpenNuphosLink(sessionUrl)}
            className="max-w-[16rem] truncate font-medium text-secondary hover:underline"
          >
            {displayName}
          </button>
        ) : (
          <span className="max-w-[16rem] truncate font-medium text-secondary">{displayName}</span>
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
        <div className="mx-auto mt-2 max-w-[85%] rounded-lg border border-border/60 px-3.5 py-2 text-[13px] break-words">
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
