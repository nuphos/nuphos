import { AtSign } from 'lucide-react'

import { ChatIcon } from '../../components/channels/channelParts'
import { t } from '../../i18n'

import type { ChannelMention } from '../../api'

/** Chats and shared agents where someone @mentioned the viewer. A row opens it. */
export function ChannelMentions({
  mentions,
  onOpen,
}: {
  mentions: ChannelMention[]
  onOpen: (channelId: string) => void
}) {
  if (mentions.length === 0) return null

  return (
    <section className="flex-shrink-0 border-b border-line-control/70">
      <div className="px-4 pt-3 pb-1 text-[12px] font-medium text-tertiary">{t('Mentions')}</div>
      <ul>
        {mentions.map((mention) => (
          <li key={mention.channelId}>
            <button
              type="button"
              onClick={() => onOpen(mention.channelId)}
              className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-[12.5px] hover:bg-state-hover"
            >
              {mention.kind === 'agent' ? (
                <AtSign className="mt-0.5 h-5 w-5 shrink-0 text-tertiary" strokeWidth={1.75} />
              ) : (
                <ChatIcon title={mention.title} size={20} className="mt-0.5" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-secondary">
                  <span className="text-main">{mention.sender?.name ?? t('Someone')}</span>{' '}
                  {t('mentioned you in {title}', { title: mention.title })}
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
