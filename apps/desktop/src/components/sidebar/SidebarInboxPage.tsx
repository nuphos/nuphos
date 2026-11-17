import { t } from '../../i18n'
import { openQuestion } from '../../views/inbox/inboxItems'
import { selectInboxQuestion, useInboxSelection } from '../../views/inbox/inboxSelection'
import { snoozeQuestion } from '../../views/inbox/dismissQuestion'
import { QuestionRail, SnoozedRail } from '../../views/inbox/QuestionRail'
import { useInboxQuestions } from '../../views/inbox/useInboxQuestions'
import { SIDEBAR_GROUP_TITLE_CLASS } from '../SidebarNavItem'

import type { UIEventHandler } from 'react'

/** The sidebar's Inbox page: the open questions, one opening in the Inbox beside it, and those snoozed below. */
export function SidebarInboxPage({
  teamId,
  onOpenInbox,
  onScroll,
}: {
  teamId: string
  onOpenInbox: () => void
  onScroll: UIEventHandler<HTMLElement>
}) {
  const rows = useInboxQuestions(teamId)
  const snoozed = useInboxQuestions(teamId, undefined, true)
  const selected = useInboxSelection(teamId)
  const open = rows ? openQuestion(rows, selected) : undefined

  return (
    <div className="sidebar-page-layout flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center px-2.5 pb-1">
        <h3 className={SIDEBAR_GROUP_TITLE_CLASS}>{t('Inbox')}</h3>
      </div>
      <nav
        onScroll={onScroll}
        className="sidebar-page-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2 scrollbar-thin scrollbar-overlay"
      >
        {rows?.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-tertiary">
            {t("You're all caught up")}
          </p>
        ) : (
          <QuestionRail
            rows={rows ?? []}
            openId={open?.request.id}
            onSelect={(row) => {
              selectInboxQuestion(teamId, row.request.id)
              onOpenInbox()
            }}
          />
        )}
        <SnoozedRail
          rows={snoozed ?? []}
          onUnsnooze={(row) =>
            void snoozeQuestion(teamId, row.conversation.sessionId, row.request.id, null)
          }
        />
      </nav>
    </div>
  )
}
