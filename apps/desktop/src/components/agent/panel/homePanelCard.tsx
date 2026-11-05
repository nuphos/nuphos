import { Button as BaseButton } from '@base-ui/react/button'
import { LayoutDashboard, PinOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { isNotFound } from '../../../api/errors'
import { PanelOutputView } from '../../../dashboards/PanelOutputView'
import { t } from '../../../i18n'

import { nextRead, panelCardBody } from './homePanelState'

import type { EmptyReason, PanelRead } from './homePanelState'
import type { HomePanel } from './homeWidgetSettings'

const REFRESH_MS = 60_000

const LINK_CLASS =
  'text-secondary underline-offset-2 hover:text-main hover:underline focus-visible:outline focus-visible:outline-2'

function readPin(teamId: string, dashboardId: string, panelId: string): Promise<PanelRead> {
  return api.dashboardsGet(teamId, dashboardId).then(
    (detail) => ({
      status: 'ok',
      dashboardName: detail.dashboard.name,
      panel: detail.panels.find((p) => p.id === panelId) ?? null,
    }),
    (err: unknown) => ({ status: isNotFound(err) ? 'not_found' : 'error' }),
  )
}

const EMPTY_TEXT: Record<EmptyReason, () => string> = {
  running: () => t('Running…'),
  failed: () => t('The last run failed'),
  never_run: () => t('Not run yet'),
  no_output: () => t('No data yet'),
}

/**
 * A dashboard panel pinned to the home page. It shows the panel's last stored
 * result and never runs the script: refreshing stays the dashboard's job, so
 * opening home costs a read, not a run on the team's runtime. A panel whose
 * dashboard says it was deleted reports `onGone` instead of taking up a card.
 */
export function DashboardPanelCard({
  teamId,
  pin,
  onUnpin,
  onGone,
  onOpenNuphosLink,
}: {
  teamId: string
  pin: HomePanel
  onOpenNuphosLink?: (href: string) => boolean
  onUnpin: () => void
  onGone: () => void
}) {
  const [read, setRead] = useState<PanelRead | null>(null)

  useEffect(() => {
    let alive = true
    const update = (next: PanelRead) => alive && setRead((prev) => nextRead(prev, next))
    const refresh = () => void readPin(teamId, pin.dashboardId, pin.panelId).then(update)

    refresh()
    const timer = setInterval(refresh, REFRESH_MS)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [teamId, pin.dashboardId, pin.panelId])

  const body = panelCardBody(read)
  const gone = body.kind === 'gone'

  useEffect(() => {
    if (gone) onGone()
  }, [gone, onGone])

  const panel = read?.status === 'ok' ? read.panel : null
  const dashboardName = read?.status === 'ok' ? read.dashboardName : ''
  const openDashboard = () =>
    onOpenNuphosLink?.(
      `/teams/${encodeURIComponent(teamId)}/dashboards/${encodeURIComponent(pin.dashboardId)}`,
    )
  let content = <div className="h-24 rounded-md bg-zGray-800/40 animate-pulse" />

  if (body.kind === 'output') {
    content = <PanelOutputView output={body.output} fill />
  } else if (body.kind === 'empty' || body.kind === 'unreachable') {
    content = (
      <div className="flex flex-col items-start gap-1 px-1 py-1.5 text-[12px] text-tertiary">
        <span>
          {body.kind === 'empty' ? EMPTY_TEXT[body.reason]() : t('Could not load this panel')}
        </span>
        {body.kind === 'empty' && (
          <BaseButton onClick={openDashboard} className={LINK_CLASS}>
            {t('Open dashboard')}
          </BaseButton>
        )}
      </div>
    )
  }

  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-zGray-800/60 p-3">
      <div className="group home-card-drag cursor-grab active:cursor-grabbing mb-2 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        <LayoutDashboard className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.8} />
        <BaseButton
          onClick={openDashboard}
          title={t('Open dashboard in dock')}
          className="min-w-0 truncate text-left hover:text-main focus-visible:outline focus-visible:outline-2"
        >
          {panel?.title ?? t('Dashboard panel')}
        </BaseButton>
        {dashboardName && <span className="truncate text-tertiary">· {dashboardName}</span>}
        <BaseButton
          onClick={onUnpin}
          aria-label={t('Unpin from home')}
          title={t('Unpin from home')}
          className="ml-auto flex-shrink-0 rounded p-0.5 text-tertiary opacity-0 outline-none transition-opacity hover:text-main focus-visible:opacity-100 group-hover:opacity-100"
        >
          <PinOff className="h-3.5 w-3.5" strokeWidth={1.8} />
        </BaseButton>
      </div>
      {/* Charts and tables take the card's height as it is resized. */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin [&>*]:h-full">{content}</div>
    </section>
  )
}

/** One line under the cards for the pins whose panel was deleted, which no longer take up a card. */
export function DeletedPinsNotice({ count, onRemove }: { count: number; onRemove: () => void }) {
  if (count === 0) return null

  return (
    <div className="flex items-center gap-2 text-[12px] text-tertiary">
      <span>
        {count === 1
          ? t('A pinned panel was deleted')
          : t('{n} pinned panels were deleted', { n: count })}
      </span>
      <BaseButton onClick={onRemove} className={LINK_CLASS}>
        {t('Remove')}
      </BaseButton>
    </div>
  )
}
