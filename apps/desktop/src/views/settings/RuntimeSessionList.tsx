import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { useAgentSessions } from '../../components/sidebar/agentSessions'
import { t } from '../../i18n'
import { isBotRow } from '../../lib/agentAvatarChoices'

import { PanelHeading } from './RuntimePanel'

import type { RuntimeInstance } from '../../types/runtime'

/** The viewer's Bots and Tasks that run on this runtime: a Bot by its face, a Task by its
 *  runtime's icon. */
export function RuntimeSessionList({
  teamId,
  instance,
}: {
  teamId: string
  instance: RuntimeInstance
}) {
  const { data } = useAgentSessions(teamId)
  const rows = (data ?? []).filter((row) => row.runtimeId === instance.id && row.kind !== 'channel')

  if (rows.length === 0) return null

  return (
    <div className="px-5 py-6">
      <PanelHeading title={t('Bots and Tasks on this runtime')} />
      <ul className="mt-3 divide-y divide-line-control/60 border-t border-line-control/60">
        {rows.map((row) => {
          const bot = isBotRow(row)

          return (
            <li key={row.sessionId} className="flex items-center gap-2.5 py-2 text-[13px]">
              <AgentAvatar
                agentId={row.sessionId}
                avatar={row.avatar}
                avatarBackground={row.avatarBackground}
                provider={instance.provider}
                size={20}
                face={bot}
                showBadge={false}
              />
              <span className="min-w-0 flex-1 truncate text-main">{row.title}</span>
              <span className="w-12 shrink-0 text-right text-[11px] text-tertiary">
                {bot ? t('Bot') : t('Task')}
              </span>
              <span className="w-14 shrink-0 text-right text-[11px] text-secondary">
                {row.activeRun ? t('Running') : t('Idle')}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
