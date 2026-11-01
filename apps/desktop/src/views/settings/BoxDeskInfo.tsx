import clsx from 'clsx'

import { t } from '../../i18n'

import { visibleAgent } from './agentPresentation'
import { deskReadings } from './boxMetricsPresentation'
import { AgentTile, NewAgentMenu } from './BoxParts'

import './BoxDeskInfo.css'

import type { agentSlots } from './boxAgentSlots'
import type { MetricsStatus } from './boxMetricsPresentation'
import type { AgentDevice } from '../../api'
import type { LocalAgentProvider } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

const clock = (iso?: string | null) => {
  const at = iso ? new Date(iso) : null

  return at && Number.isFinite(at.getTime())
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null
}

/** CPU, memory and disk, on a laptop's screen or in a box's card. A live reading needs no label;
 * only a stale or missing one says so. */
export function DeskReadings({
  device,
  metricsStatus,
}: {
  device: AgentDevice
  metricsStatus?: MetricsStatus
}) {
  const readings = deskReadings(device.metrics, metricsStatus)
  const received = clock(device.metricsReceivedAt)

  if (readings.tone === 'idle') return <p className="desk-note">{readings.status}</p>

  return (
    <div className={clsx('desk-readings', readings.tone === 'stale' && 'is-stale')}>
      {readings.tone === 'stale' && (
        <p className="desk-stale">
          {received
            ? t('{status} from {time}', { status: readings.status, time: received })
            : readings.status}
        </p>
      )}
      <div className="desk-gauges" aria-label={t('Resource usage')}>
        {readings.gauges.map((gauge) => (
          <div
            key={gauge.label}
            className="desk-gauge"
            title={[gauge.label, gauge.detail].filter(Boolean).join(' · ')}
          >
            <span className="desk-gauge-label">{gauge.label}</span>
            <span className="desk-gauge-value">{gauge.value}</span>
            <span className="desk-meter">
              <i
                className={clsx(gauge.percent !== null && gauge.percent >= 85 && 'is-high')}
                style={{ transform: `scaleX(${String((gauge.percent ?? 0) / 100)})` }}
              />
            </span>
            {gauge.detail && <span className="desk-gauge-detail">{gauge.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The machine's agents, or one short line about why there are none yet. Never empty slots. */
export function DeskAgents({
  device,
  agents,
  slots,
  away,
  dim,
  busy,
  onSelect,
  onAdd,
  onSetUp,
  canAdd,
}: {
  device: AgentDevice
  agents: RuntimeInstance[]
  slots: ReturnType<typeof agentSlots>
  /** A paused or unreachable machine lists no agents. */
  away: boolean
  dim: boolean
  busy: boolean
  onSelect: (runtimeId: string) => void
  onAdd: (provider: LocalAgentProvider) => void
  /** Opens User settings at Local runtime, where this computer's agent signs in. */
  onSetUp?: () => void
  /** Whether + shows (see canAddAgent); without it and without agents the row stays empty. */
  canAdd: boolean
}) {
  if (slots === 'noLocalAgent')
    return (
      <p className="desk-note">
        {onSetUp ? (
          <>
            {t('No agent yet')} ·{' '}
            <button type="button" className="desk-link" onClick={onSetUp}>
              {t('Set up')}
            </button>
          </>
        ) : (
          t('No agent yet · set one up in Settings › Local runtime')
        )}
      </p>
    )
  if (away) return null
  if (slots === 'starting') return <p className="desk-note">{t('Starting agents…')}</p>
  const visible = agents.filter(visibleAgent)

  if (visible.length === 0 && (dim || !canAdd)) return null

  return (
    <ul className={clsx('desk-agents', dim && 'opacity-50')}>
      {visible.map((agent) => (
        <AgentTile key={agent.id} agent={agent} onSelect={() => onSelect(agent.id)} />
      ))}
      {!dim && canAdd && (
        <li className="shrink-0">
          <NewAgentMenu device={device} agents={agents} busy={busy} onAdd={onAdd} />
        </li>
      )}
    </ul>
  )
}
