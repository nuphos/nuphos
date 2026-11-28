import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'

import { AppDemoPage } from './AppDemoPage'
import { FirstBotPage } from './FirstBotPage'
import { NotificationsPage } from './NotificationsPage'
import { RuntimesPage } from './RuntimesPage'
import { ToolsPage } from './ToolsPage'

import type { TourTool } from './tools'
import type { AtlasTeam } from '../../../types'

// Pages cross-fade in place, never sliding, so what they center stays put. These mirror the
// motion tokens in transitions-root.css: --duration-fast to fade in, --duration-quick to fade
// out, both on --ease-out.
const FADE_IN = { duration: 0.25, ease: 'easeOut' } as const
const FADE_OUT = { duration: 0.15, ease: 'easeOut' } as const
const STILL = { duration: 0 } as const

/**
 * The first run, as on iOS: what Bots, Tasks and the Inbox are, that runtimes run
 * on computers and the ones this one has with the computer Nuphos gives them, the
 * tools to reach, notifications, then a face and a name for the first Bot.
 */
export function CloudTour({
  onCreateWorkspace,
  onFinish,
}: {
  onCreateWorkspace: (name: string) => Promise<AtlasTeam>
  onFinish: (teamId: string, channelId: string) => void
}) {
  const reduce = useReducedMotion() ?? false
  const [page, setPage] = useState(0)
  const [picks, setPicks] = useState<TourTool[]>([])
  const [started, setStarted] = useState(false)
  const go = (next: number) => setPage(next)
  const next = () => go(page + 1)

  return (
    <div className="relative flex min-h-full w-full flex-col items-center justify-center">
      {page > 0 && !started && (
        <button
          type="button"
          onClick={() => go(page - 1)}
          className="titlebar-no-drag fixed left-4 top-12 z-10 flex items-center gap-0.5 rounded-md py-1 pl-1 pr-2 text-[13px] text-secondary transition-colors hover:bg-state-hover hover:text-primary"
        >
          <ChevronLeft className="size-4" />
          {t('Back')}
        </button>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={page}
          className="flex w-full justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: reduce ? STILL : FADE_IN }}
          exit={{ opacity: 0, transition: reduce ? STILL : FADE_OUT }}
        >
          {page === 0 && <AppDemoPage onNext={next} />}
          {page === 1 && <RuntimesPage onNext={next} />}
          {page === 2 && <ToolsPage picks={picks} onPicks={setPicks} onNext={next} />}
          {page === 3 && <NotificationsPage onNext={next} />}
          {page === 4 && (
            <FirstBotPage
              picks={picks}
              onCreateWorkspace={onCreateWorkspace}
              onStarted={() => setStarted(true)}
              onFinish={onFinish}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
