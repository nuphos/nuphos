import { Popover } from '@base-ui/react/popover'
import { Clock } from 'lucide-react'

import { t } from '../../i18n'
import { TitlebarDragSuspender } from '../agent/ShareCard'
import { ChatSummaryTriggers } from '../agent/summary/ChatSummaryTriggers'

/** A Bot's schedules belong to the Bot, not the channel used to talk to it. */
export function BotTriggers({ teamId, botId }: { teamId: string; botId: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={t('Triggers')}
        className="titlebar-no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-secondary hover:bg-state-hover hover:text-main data-[popup-open]:bg-state-selected"
      >
        <Clock className="size-3.5" aria-hidden />
        {t('Triggers')}
      </Popover.Trigger>
      <Popover.Portal>
        <TitlebarDragSuspender />
        <Popover.Positioner align="end" sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup
            aria-label={t('Triggers')}
            className="max-h-[min(70vh,600px)] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl bg-main shadow-lg outline-none"
          >
            <ChatSummaryTriggers teamId={teamId} sessionId={botId} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
