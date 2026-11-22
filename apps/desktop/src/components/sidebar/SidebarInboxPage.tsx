import { useEffect } from 'react'

import { t } from '../../i18n'
import { DismissAllButton } from '../../views/inbox/DismissAllButton'
import { openQuestion, shownQuestions } from '../../views/inbox/inboxItems'
import {
  selectInboxQuestion,
  setInboxSearch,
  useInboxSearch,
  useInboxSelection,
} from '../../views/inbox/inboxSelection'
import { snoozeQuestion } from '../../views/inbox/dismissQuestion'
import { QuestionRail, SnoozedRail } from '../../views/inbox/QuestionRail'
import { useInboxQuestions } from '../../views/inbox/useInboxQuestions'
import { SIDEBAR_GROUP_TITLE_CLASS } from '../SidebarNavItem'
import { SkeletonReveal } from '../SkeletonReveal'
import { SearchBox } from '../toolbar-search'

import { SidebarSectionSkeleton } from './parts'

import type { UIEventHandler } from 'react'

/**
 * The sidebar's Inbox page: the search, then the open questions it matches, one opening in the Inbox
 * beside it, and those snoozed below. "Dismiss all" acts on the ones listed.
 * With no question at all, neither the search nor "Dismiss all" shows.
 */
export function SidebarInboxPage({
  teamId,
  onOpenInbox,
  onScroll,
}: {
  teamId: string
  onOpenInbox: () => void
  onScroll: UIEventHandler<HTMLElement>
}) {
  const all = useInboxQuestions(teamId)
  const search = useInboxSearch(teamId)
  const rows = all && shownQuestions(all, search)
  const snoozed = useInboxQuestions(teamId, undefined, true)
  const selected = useInboxSelection(teamId)
  const open = rows ? openQuestion(rows, selected) : undefined
  const any = Boolean(all?.length)

  // A search hidden with an empty list holds nothing back once questions come.
  useEffect(() => {
    if (all?.length === 0) setInboxSearch(teamId, '')
  }, [teamId, all?.length])
  // No search box on screen means no filter, so the search goes when this page does.
  useEffect(() => () => setInboxSearch(teamId, ''), [teamId])

  return (
    <div className="sidebar-page-layout flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center px-2.5 pb-1">
        <h3 className={SIDEBAR_GROUP_TITLE_CLASS}>{t('Inbox')}</h3>
        <DismissAllButton teamId={teamId} questions={rows ?? []} />
      </div>
      {any && (
        <div data-inbox-search className="shrink-0 px-2.5 pb-1.5">
          <SearchBox
            filter={search}
            onFilterChange={(query) => setInboxSearch(teamId, query)}
            fill
          />
        </div>
      )}
      <nav
        onScroll={onScroll}
        className="sidebar-page-list t-scroll-fade min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2 scrollbar-thin scrollbar-overlay"
      >
        <SkeletonReveal
          className="t-sidebar-section-reveal"
          ready={rows !== null}
          skeleton={<SidebarSectionSkeleton />}
        >
          {rows?.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-tertiary">
              {any ? t('No matches') : t("You're all caught up")}
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
        </SkeletonReveal>
      </nav>
    </div>
  )
}
