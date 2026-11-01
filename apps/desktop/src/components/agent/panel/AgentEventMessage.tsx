import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'

import { t } from '../../../i18n'
import { toAbsoluteAtlasUrl } from '../../../lib/webBaseUrl'
import { Avatar } from '../../Avatar'
import { CloudLogo } from '../../CloudLogo'
import { AgentAvatar } from '../AgentAvatar'
import { MessageResponse } from '../MessageResponse'

import { Rule } from './TimelineEventLine'

import type { AgentMessageMetadata } from '../../../api/agent-types'
import type { ReactNode } from 'react'

/** A message another session or a linked resource delivered: written for the
 *  agent. Keep sender identity separate from its potentially long preview. */
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
  const contentId = useId()
  const fromAgent = metadata.source === 'agent.thread'
  const { displayName } = metadata.sender
  const resourceProvider = (['github', 'linear', 'slack', 'discord'] as const).find(
    (provider) => provider === metadata.sender.id.toLowerCase(),
  )
  const sessionUrl =
    teamId && metadata.sourceSessionId
      ? toAbsoluteAtlasUrl(`/teams/${teamId}/agent/${metadata.sourceSessionId}`)
      : null

  let icon = <Avatar name={displayName} size={14} className="shrink-0 rounded-full" />

  if (fromAgent)
    icon = (
      <AgentAvatar
        agentId={metadata.sourceSessionId ?? metadata.sender.id}
        provider={metadata.sender.agentRuntime}
      />
    )
  else if (metadata.source === 'agent.resource' && resourceProvider)
    icon = <CloudLogo provider={resourceProvider} size={14} />

  return (
    <div>
      {fromAgent ? (
        <div className="min-w-0" title={new Date(metadata.sentAt).toLocaleString()}>
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            {sessionUrl && onOpenNuphosLink ? (
              <button
                type="button"
                title={displayName}
                onClick={() => onOpenNuphosLink(sessionUrl)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-secondary hover:underline"
              >
                {displayName}
              </button>
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-[12px] font-medium text-secondary"
                title={displayName}
              >
                {displayName}
              </span>
            )}
            <button
              type="button"
              aria-label={
                open
                  ? t('Hide message from {name}', { name: displayName })
                  : t('Show message from {name}', { name: displayName })
              }
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setOpen((value) => !value)}
              className="flex size-6 shrink-0 items-center justify-center rounded text-tertiary hover:bg-zGray-800/50 hover:text-secondary"
            >
              <ChevronRight
                className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
          {!open && (
            <button
              type="button"
              aria-label={t('Preview message from {name}', { name: displayName })}
              aria-expanded={false}
              aria-controls={contentId}
              onClick={() => setOpen(true)}
              className="mt-0.5 block w-full truncate pl-8 text-left text-[11.5px] leading-5 text-tertiary hover:text-secondary"
            >
              {text.split('\n').find((line) => line.trim()) ?? t('View message')}
            </button>
          )}
        </div>
      ) : (
        <Rule title={new Date(metadata.sentAt).toLocaleString()}>
          {icon}
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
            aria-controls={contentId}
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 max-w-[50vw] items-center gap-1 hover:text-secondary"
          >
            <span className="truncate">{text.split('\n')[0]}</span>
            <ChevronRight
              className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
            />
          </button>
        </Rule>
      )}
      {open && (
        <div
          id={contentId}
          className="mt-2 rounded-lg border border-border/60 px-3.5 py-2 text-[13px] break-words"
        >
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
