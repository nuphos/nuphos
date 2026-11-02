import { metricCardDef } from './homeMetricCards'
import { MetricCardView } from './homeMetricShell'
import { useAgentStats } from './useAgentStats'

import type { HomeMetricCard as HomeMetricCardConfig } from '../../../types/team.ts'

/**
 * A metric card on the home page: loads its numbers for its range and scope.
 * Without teammates there is no one else to count, so it counts the viewer.
 */
export function HomeMetricCard({
  teamId,
  card,
  hasTeammates,
  onChange,
  onRemove,
  onOpenConversation,
}: {
  teamId: string
  card: HomeMetricCardConfig
  hasTeammates: boolean
  onChange: (card: HomeMetricCardConfig) => void
  onRemove: () => void
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const { stats, failed } = useAgentStats(teamId, card.range, hasTeammates ? card.scope : 'me')
  const def = metricCardDef(card.kind)

  if (!def) return null

  return (
    <MetricCardView
      def={def}
      card={card}
      stats={stats}
      failed={failed}
      showScope={hasTeammates}
      onChange={onChange}
      onRemove={onRemove}
      onOpenConversation={onOpenConversation}
    />
  )
}
