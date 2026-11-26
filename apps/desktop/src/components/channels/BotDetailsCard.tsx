import { clsx } from 'clsx'
import { Monitor, Pencil, X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { openSessionDesktop } from '../../app/workspace/openSessionDesktop'
import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { RenameConversationDialog } from '../agent/panel/ConversationTitleEditor'
import { AgentProviderIcon } from '../agent/panel/icons'
import { sectionClass } from '../agent/summary/ChatSummaryRows'
import { Button } from '../ui/button'
import { IconButton } from '../ui/icon-button'
import { toast } from '../ui/toast'

import type { AgentFace } from '../../api/agent-types'

/** The Bot itself, first in its chat's details: who it is, and its Task and Desktop. */
export function BotDetailsCard({
  teamId,
  bot,
  title,
  agent,
  loading = false,
  owned,
  onOpenTask,
  canOpenDesktop,
  onEdited,
  onClose,
}: {
  teamId: string
  bot: string
  title: string
  agent?: AgentFace
  loading?: boolean
  owned: boolean
  onOpenTask?: () => void
  canOpenDesktop: boolean
  onEdited: () => void
  /** Hides the details; the chat's heading opens them again. */
  onClose?: () => void
}) {
  const [editing, setEditing] = useState(false)

  if (loading)
    return (
      <section
        aria-busy="true"
        className={clsx(sectionClass, 'flex flex-col items-center gap-3 pt-5')}
      >
        <span className="size-14 rounded-full bg-state-hover" />
        <span className="h-4 w-24 rounded bg-state-hover" />
      </section>
    )

  return (
    <section
      aria-label={title}
      className={clsx(sectionClass, 'relative flex flex-col items-center pt-5 text-center')}
    >
      {(owned || onClose) && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5">
          {owned && (
            <IconButton label={t('Edit Bot')} icon={<Pencil />} onClick={() => setEditing(true)} />
          )}
          {onClose && (
            <IconButton label={t('Close')} shortcut="mod+i" icon={<X />} onClick={onClose} />
          )}
        </div>
      )}
      <AgentAvatar agentId={bot} avatar={agent?.avatar} provider={agent?.provider} size={56} />
      <p className="mt-2.5 max-w-full truncate px-16 text-[15px] font-semibold text-main">
        {title}
      </p>
      {(onOpenTask !== undefined || canOpenDesktop) && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {onOpenTask && (
            <Button variant="secondary" size="sm" title={t('Open session')} onClick={onOpenTask}>
              <AgentProviderIcon provider={agent?.provider} className="size-3.5" />
              {t('Task')}
            </Button>
          )}
          {canOpenDesktop && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                openSessionDesktop(teamId, bot, api.openSessionDesktop).catch((error: unknown) =>
                  toast.apiError(t('Could not open the desktop'), error),
                )
              }}
            >
              <Monitor className="size-3.5" />
              {t('Desktop')}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <RenameConversationDialog
          sessionId={bot}
          teamId={teamId}
          title={title}
          onClose={() => {
            setEditing(false)
            onEdited()
          }}
        />
      )}
    </section>
  )
}
