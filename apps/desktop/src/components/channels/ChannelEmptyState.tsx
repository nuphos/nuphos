import { t } from '../../i18n'

import { ChatIcon } from './channelParts'

import type { ComponentProps, ReactNode } from 'react'

export function ChannelEmptyState({
  faces,
  title,
  bot,
  preparingFirstReply,
  firstReplyFailed,
  banner,
  onOpenEarlier,
}: {
  faces: ComponentProps<typeof ChatIcon>['faces']
  title: string
  bot: boolean
  preparingFirstReply: boolean
  firstReplyFailed: boolean
  /** A line for the Bot's owner, in the intro's column, 16px under it (the gap and pt-1). */
  banner?: ReactNode
  /** Opens the Bot's own session, where the conversation it had before this chat still is. */
  onOpenEarlier?: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3 pt-10">
      <ChatIcon faces={faces} title={title} size={44} />
      <div className="text-lg font-semibold leading-snug text-main">{title}</div>
      {bot ? (
        <div className="max-w-[480px] space-y-3 text-[13px] leading-relaxed text-secondary">
          <p>
            {t(
              'This is where you and {name} get things done. Talk about what you want help with, and shape how you work together.',
              { name: title },
            )}
          </p>
          {!preparingFirstReply &&
            (firstReplyFailed ? (
              <p>{t('The first reply could not be sent. Send a message to try again.')}</p>
            ) : (
              <p>
                {t('You can start by telling {name} what you would like to do.', {
                  name: title,
                })}
              </p>
            ))}
          {onOpenEarlier && (
            <p>
              <button
                type="button"
                onClick={onOpenEarlier}
                className="font-medium text-link hover:underline"
              >
                {t('See earlier messages with {name}', { name: title })}
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="max-w-[560px] text-[13px] leading-relaxed text-secondary">
          {t(
            'Everyone here sees each message and decides for themselves whether to reply, as in any group chat.',
          )}
        </div>
      )}
      {banner && <div className="w-full max-w-[480px] pt-1">{banner}</div>}
    </div>
  )
}
