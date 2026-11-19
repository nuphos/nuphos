import { X as XIcon } from 'lucide-react'

import { AppSelect } from '../../components/ui/select'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'
import { botAvatarUrl } from '../../lib/botAvatars'

import type { SlackChannelBot, SlackChannelMapping } from '../../types'

const CHIP =
  'inline-flex h-6 items-center gap-1.5 rounded-full border border-line-control/70 bg-surface-sunken pl-1 pr-2 text-[11.5px] text-secondary'

/**
 * The Bot that answers in one Slack channel (#3702): one per channel. Its owner
 * alone takes it out; an admin removes it by disconnecting the channel.
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
  const bot = mapping.bots?.[0]
  const busy = (botSessionId: string) => busyKey === `bot:${mapping.id}:${botSessionId}`
  const addable = myBots.filter((mine) => mine.sessionId !== bot?.sessionId)
  // Taken, the channel says whose Bot holds it.
  const taken = !bot
    ? null
    : bot.mine
      ? t('One Bot per channel. Take yours out to choose another.')
      : bot.ownerName
        ? t('One Bot per channel, and this one is {name}’s.', { name: bot.ownerName })
        : t('One Bot per channel, and this one is a teammate’s.')

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {!bot && <span className="text-[11.5px] text-tertiary">{t('No Bot answers here yet.')}</span>}
      {bot && (
        <span className={CHIP}>
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
      )}
      {addable.length > 0 && (
        <AppSelect
          value=""
          onValueChange={(botSessionId) => botSessionId && onChange(botSessionId, true)}
          options={addable.map((mine) => ({ value: mine.sessionId, label: mine.title || 'Bot' }))}
          placeholder={t('Add my Bot')}
          ariaLabel={t('Add my Bot')}
          disabled={bot !== undefined}
          size="sm"
          triggerClassName="h-6 rounded-full border-dashed px-2 text-[11.5px]"
        />
      )}
      {taken && addable.length > 0 && <span className="text-[11.5px] text-tertiary">{taken}</span>}
    </div>
  )
}
