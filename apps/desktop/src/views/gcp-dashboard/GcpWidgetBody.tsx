import { ExternalLink } from 'lucide-react'

import { api } from '../../api'
import { GcpPiePanel } from '../../gcp-monitoring/PiePanel'
import { GaugePanel } from '../../grafana/components/GaugePanel'
import { StatPanel } from '../../grafana/components/StatPanel'
import { TablePanel } from '../../grafana/components/TablePanel'
import { TimeSeriesPanel } from '../../grafana/components/TimeSeriesPanel'
import { gcpFrameTimeSeriesStyle } from '../../lib/gcpDashboardPlot'

import type { DataFrame, Panel } from '../../grafana/types'
import type { GcpMonitoringDashboardWidget } from '../../types'

export function GcpWidgetBody({
  widget,
  frames,
  unit,
}: {
  widget: GcpMonitoringDashboardWidget
  frames: DataFrame[]
  unit?: string
}) {
  const targets = frames.map((frame) => ({ refId: frame.refId, legendFormat: frame.name }))
  const styles = Object.fromEntries(
    frames.map((frame) => [frame.refId, gcpFrameTimeSeriesStyle(frame.refId, widget.queries)]),
  )

  if (widget.kind === 'xy') {
    return <TimeSeriesPanel frames={frames} unit={unit} targets={targets} styles={styles} />
  }
  if (widget.kind === 'scorecard') {
    if (widget.gauge) {
      return <GaugePanel frames={frames} panel={syntheticPanel(widget, unit)} />
    }

    return <StatPanel frames={frames} unit={unit} />
  }
  if (widget.kind === 'table') {
    return <TablePanel frames={frames} panel={syntheticPanel(widget, unit)} />
  }
  if (widget.kind === 'pie') {
    return (
      <GcpPiePanel
        frames={frames}
        unit={unit}
        donut={widget.chartType === 'DONUT'}
        showLabels={widget.showLabels}
      />
    )
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center text-[12px] text-tertiary">
      No data renderer for this widget
    </div>
  )
}

function syntheticPanel(widget: GcpMonitoringDashboardWidget, unit?: string): Panel {
  const thresholdSteps = [
    { color: '#73bf69', value: null },
    ...widget.thresholds
      .map((threshold) => ({
        color:
          threshold.color ||
          (threshold.category === 'DANGER'
            ? '#fa6e6e'
            : threshold.category === 'WARNING'
              ? '#f2cc0c'
              : '#73bf69'),
        value: threshold.value,
      }))
      .sort(
        (a, b) => (a.value ?? Number.NEGATIVE_INFINITY) - (b.value ?? Number.NEGATIVE_INFINITY),
      ),
  ]

  return {
    id: 0,
    type: widget.kind === 'table' ? 'table' : 'gauge',
    title: widget.title,
    gridPos: { x: 0, y: 0, w: 24, h: 8 },
    targets: [],
    fieldConfig: {
      defaults: {
        unit,
        min: widget.gauge?.lowerBound,
        max: widget.gauge?.upperBound,
        thresholds: { mode: 'absolute', steps: thresholdSteps },
      },
    },
  }
}

export function UnsupportedPanel({ type, url }: { type: string; url: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-[12px] text-tertiary">
      <span>Widget type “{type}” is not supported in this release.</span>
      <button
        type="button"
        onClick={() => void api.appOpenExternal(url)}
        className="inline-flex items-center gap-1 text-zViolet-accent hover:underline"
      >
        Open in GCP
        <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </div>
  )
}
