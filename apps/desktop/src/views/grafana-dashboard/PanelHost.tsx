import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { queryPanel } from '../../grafana/client'
import { BarChartPanel } from '../../grafana/components/BarChartPanel'
import { BarGaugePanel } from '../../grafana/components/BarGaugePanel'
import { GaugePanel } from '../../grafana/components/GaugePanel'
import { HeatmapPanel } from '../../grafana/components/HeatmapPanel'
import { LogsPanel } from '../../grafana/components/LogsPanel'
import { PanelFrame } from '../../grafana/components/PanelFrame'
import { PieChartPanel } from '../../grafana/components/PieChartPanel'
import { StatPanel } from '../../grafana/components/StatPanel'
import { TablePanel } from '../../grafana/components/TablePanel'
import { TextPanel } from '../../grafana/components/TextPanel'
import { TimeSeriesPanel } from '../../grafana/components/TimeSeriesPanel'
import { grafanaTimeSeriesConfig } from '../../grafana/grafanaTimeSeries'
import { useResetOnKey } from '../useResetOnKey'

import type { GrafanaTarget } from '../../grafana/client'
import type { DataFrame, Panel } from '../../grafana/types'

export function PanelHost({
  target,
  panel,
  range,
  vars,
  datasourceVars,
}: {
  target: GrafanaTarget
  panel: Panel
  range: { from: number; to: number }
  vars: Record<string, string>
  datasourceVars: Record<string, string[]>
}) {
  const [frames, setFrames] = useState<DataFrame[] | null>(null)
  // The mount render already has a query in flight, so it starts fetching.
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const req = ++reqRef.current

    return queryPanel(target, panel, {
      range,
      variables: vars,
      datasourceVariables: datasourceVars,
    })
      .then((result) => {
        if (req !== reqRef.current) return
        setFrames(result)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
        setFrames([])
      })
      .finally(() => {
        if (req === reqRef.current) setFetching(false)
      })
  }, [target, panel, range, vars, datasourceVars])

  // Same inputs `load` is keyed on, flattened to a string so the pre-fetch
  // reset and the fetch stay in lockstep.
  const loadKey = useMemo(
    () =>
      `${target.teamId}|${target.instanceId}|${String(panel.id)}|${String(range.from)}|${String(range.to)}|${JSON.stringify(vars)}|${JSON.stringify(datasourceVars)}`,
    [target.teamId, target.instanceId, panel.id, range.from, range.to, vars, datasourceVars],
  )

  useResetOnKey(loadKey, () => {
    setError(null)
    setFetching(true)
  })

  useEffect(() => {
    void load()
  }, [load])

  const unit = panel.fieldConfig?.defaults?.unit

  return (
    <PanelFrame title={panel.title} loading={fetching} error={error}>
      {frames && (
        // Keep stale data visible during a refetch (time-range change), but
        // dim it so the in-flight state is obvious alongside the spinner.
        <div
          className={`absolute inset-0 transition-opacity duration-200 ${
            fetching ? 'opacity-40' : 'opacity-100'
          }`}
        >
          <PanelBody panel={panel} frames={frames} unit={unit} />
        </div>
      )}
    </PanelFrame>
  )
}

function PanelBody({ panel, frames, unit }: { panel: Panel; frames: DataFrame[]; unit?: string }) {
  switch (panel.type) {
    case 'timeseries':
      return <GrafanaTimeSeries panel={panel} frames={frames} unit={unit} />
    case 'stat':
      return <StatPanel frames={frames} unit={unit} />
    case 'logs':
      return <LogsPanel frames={frames} />
    case 'barchart':
      return <BarChartPanel frames={frames} unit={unit} />
    case 'text':
      return <TextPanel options={panel.options} />
    case 'table':
      return <TablePanel frames={frames} panel={panel} />
    case 'heatmap':
      return <HeatmapPanel frames={frames} options={panel.options} />
    case 'gauge':
      return <GaugePanel frames={frames} panel={panel} />
    case 'bargauge':
      return <BarGaugePanel frames={frames} panel={panel} unit={unit} />
    case 'piechart':
      return <PieChartPanel frames={frames} panel={panel} unit={unit} />
    default:
      return (
        <div className="absolute inset-0 flex items-center justify-center text-tertiary text-[12px] px-3 text-center">
          Panel type "{panel.type}" not yet supported
        </div>
      )
  }
}

function GrafanaTimeSeries({
  panel,
  frames,
  unit,
}: {
  panel: Panel
  frames: DataFrame[]
  unit?: string
}) {
  const config = grafanaTimeSeriesConfig(panel)
  const styles = Object.fromEntries(panel.targets.map((target) => [target.refId, config.style]))

  return (
    <TimeSeriesPanel
      frames={frames}
      unit={unit}
      targets={panel.targets}
      styles={styles}
      min={config.min}
      max={config.max}
      centeredZero={config.centeredZero}
      showLegend={config.showLegend}
    />
  )
}
