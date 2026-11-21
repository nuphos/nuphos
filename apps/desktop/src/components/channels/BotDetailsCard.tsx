import { clsx } from 'clsx'
import { Monitor, Pencil, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { openSessionDesktop } from '../../app/workspace/openSessionDesktop'
import { t } from '../../i18n'
import { AgentAvatar } from '../agent/AgentAvatar'
import { RenameConversationDialog } from '../agent/panel/ConversationTitleEditor'
import { AgentProviderIcon } from '../agent/panel/icons'
import { threadRuntimeName } from '../agent/panel/threadBadges'
import { announceTimelineChange } from '../agent/panel/timelineEvents'
import { sectionClass } from '../agent/summary/ChatSummaryRows'
import { ConfirmDialog } from '../ConfirmDialog'
import { Button } from '../ui/button'
import { IconButton } from '../ui/icon-button'
import { toast } from '../ui/toast'
import { Tooltip } from '../ui/tooltip'

import type { AgentFace } from '../../api/agent-types'

/** Its owner starts the Bot fresh: the same Bot, whose next reply opens a new conversation. */
function ReplaceButton({
  teamId,
  bot,
  title,
  replying,
  onReplaced,
}: {
  teamId: string
  bot: string
  title: string
  replying: boolean
  onReplaced: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <Tooltip
        content={t('Wait for {bot} to finish replying', { bot: title })}
        disabled={!replying}
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={replying}
          focusableWhenDisabled
          onClick={() => setConfirming(true)}
        >
          <RefreshCw className="size-3.5" />
          {t('Replace')}
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={confirming}
        title={t('Start {bot} fresh?', { bot: title })}
        description={t(
          'It keeps its name, instructions, connections, sharing and helper Bots. Its next reply starts a new conversation that carries only the last few messages of this one, so it reads less and costs less. Its messages stay here to read.',
        )}
        confirmLabel={t('Replace')}
        icon={<RefreshCw className="h-4 w-4" strokeWidth={2} />}
        onConfirm={async () => {
          try {
            await api.agentStartBotFresh(bot, teamId)
            announceTimelineChange(bot)
            onReplaced()
          } catch (error) {
            toast.apiError(t('Could not start {bot} fresh', { bot: title }), error)
          }
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}

/** The Bot itself, first in its chat's details: who it is, where it runs, its Task and Desktop, and Replace. */
export function BotDetailsCard({
  teamId,
  bot,
  title,
  agent,
  runtimeLabel,
  loading = false,
  owned,
  onOpenTask,
  canOpenDesktop,
  replying,
  onEdited,
}: {
  teamId: string
  bot: string
  title: string
  agent?: AgentFace
  runtimeLabel?: string
  loading?: boolean
  owned: boolean
  onOpenTask?: () => void
  canOpenDesktop: boolean
  /** Its turn is running: Replace waits for it. */
  replying?: boolean
  onEdited: () => void
}) {
  const [editing, setEditing] = useState(false)
  const runsOn = threadRuntimeName(agent?.provider, runtimeLabel)

  if (loading)
    return (
      <section
        aria-busy="true"
        className={clsx(sectionClass, 'flex flex-col items-center gap-3 pt-5')}
      >
        <span className="size-[72px] rounded-full bg-state-hover" />
        <span className="h-4 w-24 rounded bg-state-hover" />
      </section>
    )

  return (
    <section
      aria-label={title}
      className={clsx(sectionClass, 'relative flex flex-col items-center pt-5 text-center')}
    >
      {owned && (
        <IconButton
          label={t('Edit Bot')}
          icon={<Pencil />}
          className="absolute top-2 right-2"
          onClick={() => setEditing(true)}
        />
      )}
      <AgentAvatar agentId={bot} avatar={agent?.avatar} provider={agent?.provider} size={72} />
      <p className="mt-3 max-w-full truncate px-6 text-[15px] font-semibold text-main">{title}</p>
      {runsOn && (
        <p className="max-w-full truncate text-[12px] leading-5 text-tertiary">{runsOn}</p>
      )}
      {[onOpenTask, canOpenDesktop, owned].some(Boolean) && (
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
          {owned && (
            <ReplaceButton
              teamId={teamId}
              bot={bot}
              title={title}
              replying={Boolean(replying)}
              onReplaced={onEdited}
            />
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
