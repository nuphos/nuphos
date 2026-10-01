import { Database, Network, Server, ShieldCheck } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  CHART_COLORS,
  compact,
  deploymentLabel,
  formatDuration,
  formatTick,
} from './monitoringFormat'

import type { ChartRow } from './monitoringFormat'
import type { MongoMonitoringCapability, MongoMonitoringSample } from '../../types'
import type { ReactElement } from 'react'

export function MetricChart({
  title,
  data,
  unit,
  lines,
}: {
  title: string
  data: ChartRow[]
  unit: string
  lines: [keyof ChartRow, string][]
}) {
  const hasValues = data.some((row) => lines.some(([key]) => typeof row[key] === 'number'))

  return (
    <section className="rounded-xl border border-zGray-800 bg-zGray-950/35 p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12.5px] font-medium text-main">{title}</h3>
        <span className="text-[9.5px] text-tertiary">{data.length} samples</span>
      </div>
      <div className="mt-3 h-48">
        {!hasValues ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-zGray-800 text-center text-[10.5px] text-tertiary">
            Waiting for two samples or the required MongoDB privilege.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2730" />
              <XAxis
                dataKey="timestamp"
                tick={{ fill: '#8a8194', fontSize: 10 }}
                tickFormatter={(value) => formatTick(String(value))}
                minTickGap={38}
              />
              <YAxis
                tick={{ fill: '#8a8194', fontSize: 10 }}
                width={44}
                tickFormatter={(value: number) => compact(value)}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{
                  background: '#16141a',
                  border: '1px solid #2a2730',
                  borderRadius: 6,
                  fontSize: 11,
                }}
                labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                formatter={(value: number | string, name: string) => [
                  typeof value === 'number' ? `${value.toFixed(value >= 100 ? 0 : 2)}${unit}` : '—',
                  name,
                ]}
              />
              {lines.map(([key, label], index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={label}
                  stroke={CHART_COLORS[index]}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

export function CapabilityPanel({
  sample,
  retentionDays,
}: {
  sample: MongoMonitoringSample
  retentionDays: number
}) {
  const capabilities = Object.entries(sample.capabilities)

  return (
    <section className="rounded-xl border border-zGray-800 bg-zGray-900/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[13px] font-medium text-main">Source and metric coverage</h3>
          <p className="mt-1 text-[10.5px] text-tertiary">
            Last updated {new Date(sample.sampledAt).toLocaleString()} · collection took{' '}
            {sample.durationMs} ms · retained for {retentionDays} days
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {capabilities.map(([name, state]) => (
            <CapabilityBadge key={name} name={name} state={state} />
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Info
          label="Deployment"
          value={deploymentLabel(sample.deploymentType)}
          icon={<Database />}
        />
        <Info
          label="Node"
          value={sample.node ?? sample.process ?? 'Not reported'}
          icon={<Server />}
        />
        <Info
          label="Collection boundary"
          value="Backend direct · numeric only"
          icon={<ShieldCheck />}
        />
      </div>
      {sample.replicaMembers.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-zGray-800">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_90px] border-b border-zGray-800 px-3 py-2 text-[9.5px] uppercase tracking-wide text-tertiary">
            <span>Replica member</span>
            <span>State</span>
            <span>Lag</span>
          </div>
          {sample.replicaMembers.map((member) => (
            <div
              key={member.name}
              className="grid grid-cols-[minmax(0,1fr)_120px_90px] border-b border-zGray-800/60 px-3 py-2 text-[10.5px] last:border-b-0"
            >
              <span className="truncate font-mono text-secondary">{member.name}</span>
              <span className="text-tertiary">
                {member.state}
                {member.self ? ' · self' : ''}
              </span>
              <span className="text-tertiary">{formatDuration(member.lagSeconds)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function CapabilityBadge({ name, state }: { name: string; state: MongoMonitoringCapability }) {
  const label = name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
  const style =
    state === 'available'
      ? 'border-success/30 bg-success/5 text-success'
      : state === 'unsupported'
        ? 'border-zGray-700 text-tertiary'
        : 'border-warning/30 bg-warning/5 text-warning'

  return (
    <span
      title={`${label}: ${state}`}
      className={`rounded-full border px-2 py-0.5 text-[9px] ${style}`}
    >
      {label} · {state}
    </span>
  )
}

function Info({ label, value, icon }: { label: string; value: string; icon: ReactElement }) {
  return (
    <div className="rounded-lg border border-zGray-800 bg-zGray-950/30 p-3">
      <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wide text-tertiary">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 truncate text-[11px] text-secondary">{value}</div>
    </div>
  )
}

export function EmptyMonitoring() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-zGray-700 px-6 text-center">
      <Network className="h-7 w-7 text-zGray-600" />
      <div className="mt-3 text-[12.5px] text-secondary">No metric samples yet</div>
      <p className="mt-1 max-w-lg text-[10.5px] leading-4 text-tertiary">
        Keep this page open or use refresh to collect a bounded serverStatus snapshot. Restricted
        MongoDB accounts will show unavailable capabilities explicitly.
      </p>
    </div>
  )
}
