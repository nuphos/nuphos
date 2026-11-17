import { t } from '../../i18n'

import { ChatIcon } from './channelParts'

import type { ComponentProps } from 'react'

export function ChannelEmptyState({
  faces,
  title,
  bot,
  preparingFirstReply,
  firstReplyFailed,
}: {
  faces: ComponentProps<typeof ChatIcon>['faces']
  title: string
  bot: boolean
  preparingFirstReply: boolean
  firstReplyFailed: boolean
}) {
  return (
    <div className="flex flex-col items-start gap-3 pt-10">
      <ChatIcon faces={faces} title={title} size={44} />
      <div className="text-lg font-semibold leading-snug text-main">{title}</div>
      {bot ? (
        <div className="max-w-[480px] space-y-3 text-[13px] leading-relaxed text-secondary">
          <p>
            {t(
              'This is your conversation with {name}. Talk about what you want help with, and shape how you work together.',
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
        </div>
      ) : (
        <div className="max-w-[560px] text-[13px] leading-relaxed text-secondary">
          {t(
            'Everyone here sees each message and decides for themselves whether to reply, as in any group chat.',
          )}
        </div>
      )}
    </div>
  )
}
