import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, CircleDashed } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import { readLocalStorage, writeLocalStorage } from '../../../app/localStorage'
import { Button } from '../../../components/ui/button'
import { t } from '../../../i18n'
import { isMac, isWindows } from '../../../lib/platform'

import { useSequence } from './sequence'
import { TourLayout } from './TourLayout'

import type { ReactNode } from 'react'

const KEY = 'nuphos.onboarding.notificationsOn'
/** Linux desktops have no one settings page to open. */
const canOpenSettings = isMac || isWindows

type Permission = 'unknown' | 'on' | 'off'

/**
 * Page four: what a Bot's notifications look like. Turn On shows a first
 * notification from the main process, which is what makes macOS ask; Electron
 * cannot read the answer back, so a notification macOS refuses is the only sign
 * that it was turned off, and then only System Settings can turn it on.
 */
export function NotificationsPage({ onNext }: { onNext: () => void }) {
  const [activity, setActivity] = useState(false)
  const [count, setCount] = useState(0)
  const [permission, setPermission] = useState<Permission>(() =>
    readLocalStorage(KEY) === '1' ? 'on' : 'unknown',
  )
  const [asking, setAsking] = useState(false)
  const { revealed } = useSequence(() => [
    [0.6, () => setActivity(true)],
    [1.0, () => setCount(1)],
    [1.0, () => setCount(2)],
  ])

  const turnOn = async () => {
    setAsking(true)
    const result = await api.appRequestNotifications().catch(() => 'failed' as const)

    setAsking(false)

    if (result === 'failed' || result === 'unsupported') return setPermission('off')
    writeLocalStorage(KEY, '1')
    setPermission('on')
    onNext()
  }

  return (
    <TourLayout
      dot={3}
      title={t('Know when your Bot needs you')}
      subtitle={t(
        'Follow running work from your desktop, and get a notification when it’s done or needs an answer.',
      )}
      revealed={revealed}
      note={
        permission === 'on' ? (
          <span className="flex items-center gap-1.5 text-[13px] text-secondary">
            <CheckCircle2 className="size-4 text-success" />
            {t('Notifications are on')}
          </span>
        ) : (
          permission === 'off' && (
            <span className="text-[13px] text-secondary">
              {isMac
                ? t('Notifications are off for Nuphos. Turn them on in System Settings.')
                : t('Notifications are off for Nuphos. Turn them on in your system settings.')}
            </span>
          )
        )
      }
      actions={
        permission === 'on' ? (
          <Button onClick={onNext}>{t('Continue')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onNext}>
              {t('Later')}
            </Button>
            {permission === 'off' ? (
              canOpenSettings && (
                <Button onClick={() => void api.appOpenNotificationSettings()}>
                  {t('Open Settings')}
                </Button>
              )
            ) : (
              <Button disabled={asking} onClick={() => void turnOn()}>
                {t('Turn On')}
              </Button>
            )}
          </>
        )
      }
      art={
        <div className="relative h-[300px] w-[440px] overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#3b4a6b,#6b5b8a_55%,#c48a7a)] text-left shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <div className="flex h-6 items-center justify-end gap-3 bg-black/20 px-3 text-[11px] font-medium text-white/90">
            <span>{t('Friday, November 20')}</span>
            <span>9:41</span>
          </div>
          <div className="absolute right-3 top-9 flex w-[300px] flex-col gap-2">
            <AnimatePresence initial={false}>
              {activity && <LiveActivity key="activity" />}
              {count > 1 && (
                <Banner
                  key="standup"
                  lead={<AppIcon />}
                  title={t('Summarize today’s standup')}
                  time={t('now')}
                >
                  {t('Done. 5 key points and 2 action items.')}
                </Banner>
              )}
              {count > 0 && (
                <Banner
                  key="frida"
                  lead={
                    <span className="relative size-8 shrink-0">
                      <img
                        src="/bot-avatars/09-frida.svg"
                        alt=""
                        className="size-8 rounded-full bg-white/60"
                      />
                      <img
                        src="/nuphos-icon.png"
                        alt=""
                        className="absolute -bottom-[3px] -right-[3px] size-3.5 rounded-[4px]"
                      />
                    </span>
                  }
                  title="Frida"
                  time={t('now')}
                >
                  {t('I drafted replies to 3 emails. Want to review them before I send?')}
                </Banner>
              )}
            </AnimatePresence>
          </div>
        </div>
      }
    />
  )
}

function Banner({
  lead,
  title,
  time,
  children,
}: {
  lead: ReactNode
  title: string
  time: string
  children: string
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="flex gap-2.5 rounded-2xl bg-white/80 p-2.5 text-[#1d1d1f] shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur-md"
    >
      {lead}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 truncate text-[12.5px] font-semibold">{title}</span>
          <span className="text-[11px] text-black/50">{time}</span>
        </div>
        <p className="text-[12px] leading-4 text-black/75">{children}</p>
      </div>
    </motion.div>
  )
}

function AppIcon() {
  return <img src="/nuphos-icon.png" alt="" className="size-8 rounded-lg" />
}

/** The running task, as the approved iOS Live Activity draws it, with fictional data. */
function LiveActivity() {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="flex flex-col gap-2 rounded-[22px] bg-surface-raised p-3.5 text-primary shadow-[0_6px_20px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-center gap-1.5">
        <img src="/nuphos-icon.png" alt="" className="size-5 rounded-full" />
        <span className="flex-1 text-[12.5px] font-semibold">Nuphos</span>
        <span className="rounded-full bg-success/12 px-2 py-1 text-[11px] font-semibold leading-none text-success">
          {t('Running')}
        </span>
      </div>
      <div className="flex min-h-10 items-center gap-2">
        <CircleDashed className="size-3.5 shrink-0 text-success" strokeWidth={2.4} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold">
            {t('Find a time for next week’s review')}
          </p>
          <p className="truncate text-[11px] text-tertiary">OpenCode · Cloud Box</p>
        </div>
        <span className="text-[11.5px] tabular-nums text-tertiary">4:10</span>
      </div>
    </motion.div>
  )
}
