import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Bot, Inbox, ListChecks, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import { AgentProviderIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { t } from '../../../i18n'

import { useSequence } from './sequence'
import { TourLayout } from './TourLayout'

import type { AgentProvider } from '../../../types/runtime'
import type { ReactNode } from 'react'

type Tab = 'bots' | 'tasks' | 'inbox'

const spring = { type: 'spring', stiffness: 260, damping: 26 } as const

/** Page one: a small copy of the app, showing a Bot list, then Tasks, then the Inbox. */
export function AppDemoPage({ onNext }: { onNext: () => void }) {
  const [tab, setTab] = useState<Tab>('bots')
  const [rows, setRows] = useState(0)
  const show = (next: Tab) => () => {
    setTab(next)
    setRows(0)
  }
  const { revealed, takeOver } = useSequence(() => [
    [0.3, () => setRows(1)],
    [0.2, () => setRows(2)],
    [0.2, () => setRows(3)],
    [1.0, show('tasks')],
    [0.15, () => setRows(1)],
    [0.2, () => setRows(2)],
    [0.2, () => setRows(3)],
    [1.0, show('inbox')],
    [0.15, () => setRows(1)],
    [0.2, () => setRows(2)],
  ])
  const pick = (next: Tab) => {
    takeOver()
    setTab(next)
    setRows(3)
  }

  return (
    <TourLayout
      dot={0}
      title={t('Bots, Tasks, and your Inbox')}
      subtitle={t(
        'Bots are teammates that remember your work, alone or with your team in a channel. Tasks take one-off jobs to Claude Code, Codex, or Grok Build. Anything that needs you lands in your Inbox.',
      )}
      revealed={revealed}
      actions={<Button onClick={onNext}>{t('Continue')}</Button>}
      art={
        <div className="flex h-[300px] w-[380px] flex-col overflow-hidden rounded-2xl border border-line-control bg-surface-raised text-left shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
          <div className="flex-1 space-y-0.5 p-2">
            <AnimatePresence initial={false}>
              {demoRows(tab)
                .slice(0, rows)
                .map((row) => (
                  <motion.div
                    key={`${tab}-${row.title}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring}
                  >
                    <DemoRow {...row} />
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>
          <nav className="grid grid-cols-3 border-t border-line-control/70 py-1.5">
            <TabButton
              icon={<Bot />}
              label={t('Bots')}
              on={tab === 'bots'}
              click={() => pick('bots')}
            />
            <TabButton
              icon={<ListChecks />}
              label={t('Tasks')}
              on={tab === 'tasks'}
              click={() => pick('tasks')}
            />
            <TabButton
              icon={<Inbox />}
              label={t('Inbox')}
              on={tab === 'inbox'}
              badge="2"
              click={() => pick('inbox')}
            />
          </nav>
        </div>
      }
    />
  )
}

type Row = {
  title: string
  detail: string
  lead: ReactNode
  trail?: ReactNode
  badge?: string
}

const face = (file: string) => (
  <img
    src={`/bot-avatars/${file}.svg`}
    alt=""
    className="size-9 rounded-full bg-surface-sunken object-contain"
  />
)

const runtime = (provider: AgentProvider) => (
  <span className="grid size-9 place-items-center rounded-full bg-surface-sunken">
    <AgentProviderIcon provider={provider} className="size-[18px]" />
  </span>
)

const spinner = (
  <LoaderCircle className="size-3.5 animate-spin text-tertiary motion-reduce:animate-none" />
)

function demoRows(tab: Tab): Row[] {
  if (tab === 'tasks')
    return [
      {
        lead: runtime('claude-code'),
        title: t('Summarize today’s standup'),
        detail: t('Done · 5 key points'),
        trail: '9:40',
      },
      {
        lead: runtime('codex'),
        title: t('Find a time for next week’s review'),
        detail: t('Checking 4 calendars'),
        trail: spinner,
      },
      {
        lead: runtime('grok'),
        title: t('Clean up my inbox'),
        detail: t('Archived 42 newsletters'),
        trail: spinner,
      },
    ]
  if (tab === 'inbox')
    return [
      {
        lead: face('09-frida'),
        title: t('Send 3 replies?'),
        detail: t('Frida needs your answer'),
        badge: t('Reply'),
      },
      {
        lead: face('02-leonardo'),
        title: t('Move Acme call to 3 PM?'),
        detail: t('Leonardo needs your answer'),
        badge: t('Reply'),
      },
    ]

  return [
    {
      lead: face('09-frida'),
      title: 'Frida',
      detail: t('Drafted replies to 3 emails'),
      trail: '9:41',
    },
    {
      lead: <TeamFaces />,
      title: '#launch-planning',
      detail: t('Leonardo: Meeting notes are posted for everyone'),
      trail: '9:30',
      badge: t('Team'),
    },
    {
      lead: face('02-leonardo'),
      title: 'Leonardo',
      detail: t('Your 2 PM with Acme moved to 3 PM'),
      trail: '9:12',
    },
  ]
}

/** Two people over one Bot. The tints are the same in both themes, so the initials take a fixed ink. */
function TeamFaces() {
  const person =
    'absolute top-0 grid size-[18px] place-items-center rounded-full text-[10px] font-bold'

  return (
    <span className="relative block size-9 shrink-0">
      <span className={`${person} left-0 bg-avatar-sky text-[#2F4F7F]`}>A</span>
      <span className={`${person} right-0 bg-avatar-peach text-[#8A3B12]`}>M</span>
      <img
        src="/bot-avatars/02-leonardo.svg"
        alt=""
        className="absolute bottom-0 left-2 size-5 rounded-full bg-surface-sunken ring-2 ring-surface-raised"
      />
    </span>
  )
}

function DemoRow({ lead, title, detail, trail, badge }: Row) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2">
      {lead}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-primary">{title}</span>
          {badge && (
            <span className="rounded-full bg-surface-sunken px-1.5 py-px text-[10.5px] text-secondary">
              {badge}
            </span>
          )}
        </div>
        <p className="truncate text-[12.5px] text-secondary">{detail}</p>
      </div>
      {trail && <span className="shrink-0 text-[11.5px] text-tertiary">{trail}</span>}
    </div>
  )
}

function TabButton({
  icon,
  label,
  on,
  badge,
  click,
}: {
  icon: ReactNode
  label: string
  on: boolean
  badge?: string
  click: () => void
}) {
  return (
    <button
      type="button"
      onClick={click}
      className={clsx(
        'relative flex flex-col items-center gap-0.5 py-1 text-[11px] transition-colors [&_svg]:size-[18px]',
        on ? 'text-primary' : 'text-tertiary hover:text-secondary',
      )}
    >
      {icon}
      {label}
      {badge && (
        <span className="absolute left-1/2 top-0 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-status-danger px-1 text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  )
}
