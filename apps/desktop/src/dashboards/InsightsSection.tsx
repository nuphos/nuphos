import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { memo, useState } from 'react'

import type { DashboardPanel, OpenAgentChat } from './schema'

const KIND_LABEL: Record<string, string> = {
  insight: 'Insight',
  anomaly: 'Anomaly',
  driver: 'Driver',
  hypothesis: 'Hypothesis',
}

function completeFindings(panel: DashboardPanel) {
  if (panel.insight?.status !== 'complete') return []

  return panel.insight.findings
}

/**
 * Anomaly-only alert shown above the panels: the single case where an AI
 * finding earns a place ahead of the data. Clicking switches the dashboard to
 * its Insights view — everything else lives there.
 */
export const InsightsAnomalyBanner = memo(
  ({ panels, onViewInsights }: { panels: DashboardPanel[]; onViewInsights: () => void }) => {
    const anomalies = panels.flatMap((p) => completeFindings(p).filter((f) => f.kind === 'anomaly'))

    if (anomalies.length === 0) return null

    return (
      <button
        type="button"
        className="mb-3 flex w-full items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-left text-[12.5px] text-warning outline-none hover:bg-warning/15 focus:bg-warning/15"
        onClick={onViewInsights}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0 font-medium">
          {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'}
        </span>
        <span className="truncate">— {anomalies[0].title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 font-medium">
          View insights <ArrowRight className="h-3 w-3" />
        </span>
      </button>
    )
  },
)

InsightsAnomalyBanner.displayName = 'InsightsAnomalyBanner'

type SectionProps = {
  panels: DashboardPanel[]
  regenPanels: Set<string>
  onOpenAgentChat: OpenAgentChat
  onFeedback: (panel: DashboardPanel, rating: 'up' | 'down') => void
  onRegenerate: (panel: DashboardPanel) => void
  onJumpToPanel: (panelId: string) => void
}

/**
 * The dashboard's Insights view — a sibling of the panel canvas, toggled from
 * the dashboard toolbar. One card per panel: header names the panel (click to
 * jump back to its chart), findings read as title + paragraph, actions hand
 * off to the agent's plan flow.
 */
export const InsightsSection = memo(
  ({
    panels,
    regenPanels,
    onOpenAgentChat,
    onFeedback,
    onRegenerate,
    onJumpToPanel,
  }: SectionProps) => {
    const withContent = panels.filter(
      (p) =>
        p.insight?.status === 'complete' &&
        (p.insight.findings.length > 0 || p.insight.actions.length > 0),
    )
    const generating = panels.filter(
      (p) => p.insight?.status === 'pending' && p.currentSnapshot?.status === 'complete',
    )
    // Complete snapshot but no usable insight (never generated, failed, or empty)
    // → offer manual generation.
    const generatable = panels.filter(
      (p) =>
        p.currentSnapshot?.status === 'complete' &&
        p.insight?.status !== 'pending' &&
        (p.insight?.status !== 'complete' ||
          (p.insight.findings.length === 0 && p.insight.actions.length === 0)),
    )

    if (withContent.length === 0 && generating.length === 0 && generatable.length === 0) {
      return (
        <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-center">
          <Sparkles className="h-4 w-4 text-tertiary" />
          <div className="text-[12.5px] text-tertiary">
            No insights yet — generate one for any completed panel.
          </div>
        </div>
      )
    }

    const findingCount = withContent.reduce((sum, p) => sum + completeFindings(p).length, 0)
    const anomalyCount = withContent.reduce(
      (sum, p) => sum + completeFindings(p).filter((finding) => finding.kind === 'anomaly').length,
      0,
    )

    return (
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-zViolet-accent" />
          <span className="text-[13px] font-semibold text-main">Insights & Suggestions</span>
          {findingCount > 0 && (
            <span className="text-[12px] text-tertiary">
              {findingCount} finding{findingCount === 1 ? '' : 's'}
              {anomalyCount > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span className="text-warning">
                    {anomalyCount} anomal{anomalyCount === 1 ? 'y' : 'ies'}
                  </span>
                </>
              )}
            </span>
          )}
        </div>

        <div className="mt-2 space-y-3">
          {withContent.map((panel) => (
            <PanelInsightCard
              // Remount after regeneration or a range switch so local feedback
              // state resets without a synchronization effect.
              key={
                panel.insight?.status === 'complete'
                  ? `${panel.insight.id}:${panel.insight.updatedAt}`
                  : panel.id
              }
              panel={panel}
              regenerating={regenPanels.has(panel.id)}
              onOpenAgentChat={onOpenAgentChat}
              onFeedback={onFeedback}
              onRegenerate={onRegenerate}
              onJumpToPanel={onJumpToPanel}
            />
          ))}

          {(generating.length > 0 || generatable.length > 0) && (
            <div className="space-y-1.5">
              {generating.map((panel) => (
                <div key={panel.id} className="flex items-center gap-1.5 text-[12px] text-tertiary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating insight —{' '}
                  {panel.title}
                </div>
              ))}
              {generatable.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  className="flex items-center gap-1.5 text-[12px] text-zViolet-accent hover:text-zViolet-300 disabled:opacity-50"
                  disabled={regenPanels.has(panel.id)}
                  onClick={() => onRegenerate(panel)}
                >
                  {regenPanels.has(panel.id) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Generate insight — {panel.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  },
)

InsightsSection.displayName = 'InsightsSection'

function PanelInsightCard({
  panel,
  regenerating,
  onOpenAgentChat,
  onFeedback,
  onRegenerate,
  onJumpToPanel,
}: {
  panel: DashboardPanel
  regenerating: boolean
  onOpenAgentChat: OpenAgentChat
  onFeedback: (panel: DashboardPanel, rating: 'up' | 'down') => void
  onRegenerate: (panel: DashboardPanel) => void
  onJumpToPanel: (panelId: string) => void
}) {
  const insight = panel.insight!
  // Card is keyed on the insight id at the call site, so this initializes once
  // per insight and a prior insight's rating can never stick to the new one.
  const [rated, setRated] = useState<'up' | 'down' | null>(insight.feedback?.rating ?? null)

  return (
    <div className="overflow-hidden rounded-lg border border-zGray-800 bg-zGray-900/40">
      <div className="flex items-center gap-2 border-b border-zGray-800 px-3 py-2">
        <button
          type="button"
          className="truncate text-[13px] font-medium text-main hover:underline"
          title="Jump to panel"
          onClick={() => onJumpToPanel(panel.id)}
        >
          {panel.title}
        </button>
        {panel.insightStale && (
          <button
            type="button"
            className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-warning hover:bg-warning/10 disabled:opacity-50"
            disabled={regenerating}
            onClick={() => onRegenerate(panel)}
            title="Data changed since this insight — regenerate"
          >
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Data updated · regenerate
          </button>
        )}
      </div>

      <div className="space-y-2.5 px-3 py-2.5">
        {insight.findings.map((f, i) => (
          <div key={i}>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`shrink-0 rounded px-1 py-0.5 text-[10px] uppercase ${
                  f.kind === 'anomaly' ? 'bg-warning/15 text-warning' : 'bg-zGray-800 text-tertiary'
                }`}
              >
                {KIND_LABEL[f.kind] ?? f.kind}
              </span>
              <span className="text-[12.5px] font-medium text-main">{f.title}</span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-secondary">{f.detail}</p>
          </div>
        ))}

        <div className="flex flex-wrap items-stretch gap-1.5 border-t border-zGray-850 pt-2.5">
          <button
            type="button"
            className={`flex items-center gap-1 rounded border px-1.5 py-1 text-[11.5px] ${rated === 'up' ? 'border-success/50 bg-success/10 text-success' : 'border-zGray-800 text-tertiary hover:text-main'}`}
            onClick={() => {
              setRated('up')
              onFeedback(panel, 'up')
            }}
          >
            <ThumbsUp className="h-3 w-3" /> Helpful
          </button>
          <button
            type="button"
            aria-label="Not helpful"
            title="Not helpful"
            className={`flex items-center gap-1 rounded border px-1.5 py-1 text-[11.5px] ${rated === 'down' ? 'border-error/50 bg-error/10 text-error' : 'border-zGray-800 text-tertiary hover:text-main'}`}
            onClick={() => {
              setRated('down')
              onFeedback(panel, 'down')
            }}
          >
            <ThumbsDown className="h-3 w-3" />
          </button>

          {insight.actions.length > 0 && (
            <span className="mx-0.5 self-center text-tertiary">·</span>
          )}
          {insight.actions.map((a, i) => (
            <button
              key={i}
              type="button"
              title={a.detail}
              className="flex items-center gap-1 rounded border border-zViolet-500/30 px-2 py-1 text-[11.5px] text-zViolet-accent hover:bg-zViolet-500/10"
              onClick={() => onOpenAgentChat(a.prompt, { send: true })}
            >
              {a.title} <ArrowRight className="h-3 w-3" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
