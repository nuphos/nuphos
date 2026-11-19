import { X as XIcon } from 'lucide-react'

import { AppSelect } from '../../components/ui/select'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'
import { botAvatarUrl } from '../../lib/botAvatars'

import type { SlackChannelBot, SlackChannelMapping } from '../../types'

const CHIP =
  'inline-flex h-6 items-center gap-1.5 rounded-full border border-line-control/70 bg-surface-sunken pl-1 pr-2 text-[11.5px] text-secondary'

/**
 * The Bots that answer in one Slack channel (#3702). Each member brings or
 * takes out only their own Bots; an admin removes them all by disconnecting.
 */
export function ChannelBots({
  mapping,
  myBots,
  busyKey,
  onChange,
}: {
  mapping: SlackChannelMapping
  myBots: SlackChannelBot[]
  busyKey: string | null
  onChange: (botSessionId: string, answers: boolean) => void
}) {
  const bots = mapping.bots ?? []
  const addable = myBots.filter((bot) => !bots.some((there) => there.sessionId === bot.sessionId))
  const busy = (botSessionId: string) => busyKey === `bot:${mapping.id}:${botSessionId}`

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {bots.length === 0 && (
        <span className="text-[11.5px] text-tertiary">{t('No Bots answer here yet.')}</span>
      )}
      {bots.map((bot) => (
        <span key={bot.sessionId} className={CHIP}>
          <img
            src={botAvatarUrl(bot.sessionId, bot.avatar)}
            alt=""
            className="h-4 w-4 rounded-full"
            draggable={false}
          />
          <span className="max-w-[10rem] truncate">{bot.title || 'Bot'}</span>
          {bot.mine && (
            <button
              type="button"
              onClick={() => onChange(bot.sessionId, false)}
              disabled={busy(bot.sessionId)}
              className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-tertiary hover:text-main disabled:opacity-50"
              title={t('Take {name} out of this channel', { name: bot.title || 'Bot' })}
            >
              <UiIcon size={12} icon={XIcon} className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {addable.length > 0 && (
        <AppSelect
          value=""
          onValueChange={(botSessionId) => botSessionId && onChange(botSessionId, true)}
          options={addable.map((bot) => ({ value: bot.sessionId, label: bot.title || 'Bot' }))}
          placeholder={t('Add my Bot')}
          ariaLabel={t('Add my Bot')}
          size="sm"
          triggerClassName="h-6 rounded-full border-dashed px-2 text-[11.5px]"
        />
      )}
    </div>
  )
}
