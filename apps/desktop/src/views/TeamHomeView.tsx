import { ChartNoAxesColumn } from 'lucide-react'

import { HomeWidgets } from '../components/agent/panel/HomeWidgets'
import { t } from '../i18n'

import { StatsSubscriptions } from './stats/StatsSubscriptions'

import type { ReactNode } from 'react'

/** One shared, personal data surface above Bots and Tasks. */
export function TeamHomeView({
  teamId,
  refreshKey,
  isTeamAdmin,
  onOpenConversation,
  onOpenLink,
  customBoards,
  customBoardOpen,
}: {
  teamId: string
  refreshKey: number
  isTeamAdmin: boolean
  onOpenConversation: (id: string) => void
  onOpenLink: (href: string) => void
  customBoards: ReactNode
  customBoardOpen: boolean
}) {
  return (
    <div className="h-full overflow-y-auto px-6 pb-12 pt-5 scrollbar-thin">
      <div className="mx-auto w-full max-w-[820px] space-y-8">
        <h1 className="text-lg font-medium text-main">{t('Stats')}</h1>
        <section
          aria-label={t('Virtual office')}
          className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-line-control px-4 py-4"
        >
          <div>
            <h2 className="text-sm font-medium text-main">{t('Virtual office')}</h2>
            <p className="mt-1 text-xs text-tertiary">{t('A shared space for your bots.')}</p>
          </div>
          <span className="shrink-0 rounded-full bg-state-selected px-2.5 py-1 text-xs text-tertiary">
            {t('Coming soon')}
          </span>
        </section>
        <HomeWidgets
          key={`${teamId}:${String(refreshKey)}`}
          teamId={teamId}
          isTeamAdmin={isTeamAdmin}
          revealAt={0}
          replayKey={0}
          onOpenConversation={onOpenConversation}
          onOpenNuphosLink={(href) => {
            onOpenLink(href)

            return true
          }}
        />
        <section aria-label={t('Subscription usage')}>
          <h2 className="mb-4 text-sm font-medium text-main">{t('Subscription usage')}</h2>
          <StatsSubscriptions teamId={teamId} />
        </section>
        <section aria-label={t('Custom boards')}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-main">
            <ChartNoAxesColumn className="size-4 text-tertiary" />
            {t('Custom boards')}
          </h2>
          <div
            className={
              customBoardOpen
                ? 'h-[640px] min-h-0 overflow-hidden rounded-xl border border-line-control'
                : ''
            }
          >
            {customBoards}
          </div>
        </section>
      </div>
    </div>
  )
}
