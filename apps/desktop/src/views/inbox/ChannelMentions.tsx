import { ChannelMark } from '../../components/channels/channelParts'
import { t } from '../../i18n'

import type { ChannelMention } from '../../api'

/** Channels where someone @mentioned the viewer. A row opens the channel. */
export function ChannelMentions({
  mentions,
  onOpen,
}: {
  mentions: ChannelMention[]
  onOpen: (channelId: string) => void
}) {
  if (mentions.length === 0) return null

  return (
    <section className="flex-shrink-0 border-b border-zGray-800/70">
      <div className="px-4 pt-3 pb-1 text-[12px] font-medium text-tertiary">
        {t('Mentions in channels')}
      </div>
      <ul>
        {mentions.map((mention) => (
          <li key={mention.channelId}>
            <button
              type="button"
              onClick={() => onOpen(mention.channelId)}
              className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-[12.5px] hover:bg-zGray-800/40"
            >
              <ChannelMark size={20} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-secondary">
                  <span className="text-main">{mention.sender?.name ?? t('Someone')}</span>{' '}
                  {t('mentioned you in #{name}', { name: mention.title })}
                </span>
                <span className="block truncate text-tertiary">{mention.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
