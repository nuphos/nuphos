import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'
import { botAvatarUrl } from '../../lib/botAvatars'

import type { SlackChannelBot, SlackChannelMapping } from '../../types'

const NONE = 'none'

function BotFace({ bot }: { bot: SlackChannelBot }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <img
        src={botAvatarUrl(bot.sessionId, bot.avatar)}
        alt=""
        className="h-4 w-4 flex-shrink-0 rounded-full"
        draggable={false}
      />
      <span className="truncate">{bot.title || 'Bot'}</span>
    </span>
  )
}

/**
 * The one Bot that answers in a Slack channel (#3702), as a single choice. Its
 * owner picks it from their own Bots, swaps or removes it; a teammate's Bot only shows.
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
  const theirs = bot && !bot.mine ? bot : undefined
  const busy = busyKey?.startsWith(`bot:${mapping.id}:`) ?? false

  if (!bot && myBots.length === 0)
    return <div className="mt-2 text-[11.5px] text-tertiary">{t('No Bot answers here yet.')}</div>
  const options = theirs
    ? [{ value: theirs.sessionId, label: <BotFace bot={theirs} /> }]
    : [
        ...myBots.map((mine) => ({ value: mine.sessionId, label: <BotFace bot={mine} /> })),
        ...(bot ? [{ value: NONE, label: t('No Bot') }] : []),
      ]

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <AppSelect
        value={bot?.sessionId ?? ''}
        onValueChange={(value) => {
          if (value === NONE && bot) onChange(bot.sessionId, false)
          else if (value && value !== NONE && value !== bot?.sessionId) onChange(value, true)
        }}
        options={options}
        placeholder={t('Choose a Bot')}
        ariaLabel={t('Bot for this channel')}
        disabled={Boolean(theirs) || busy}
        size="sm"
        triggerClassName="h-7 w-48 px-2 text-[12px]"
      />
      {theirs && (
        <span className="text-[11.5px] text-tertiary">
          {theirs.ownerName
            ? t('{name}’s Bot. Only they can change it.', { name: theirs.ownerName })
            : t('A teammate’s Bot. Only they can change it.')}
        </span>
      )}
    </div>
  )
}
