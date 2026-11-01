import { metricKey } from './homeWidgetSettings.ts'

import type { HomeCardKind } from './homeCardCatalog.ts'
import type { HomeGithubCard, HomeLayout, HomeMetricCard } from '../../../types/team.ts'

/**
 * `layout` with one more card of `kind`, and the new card's grid key. Team
 * activity is turned on, a GitHub card starts with `github`'s repositories
 * and statuses (none and its first status without one), and a metric card
 * counts the member's own last 7 days. Dashboard panels are pinned with
 * toggleItem instead.
 */
export function addCard(
  layout: HomeLayout,
  kind: Exclude<HomeCardKind, 'panel'>,
  id: string,
  github?: Pick<HomeGithubCard, 'repos' | 'statuses'>,
): { layout: HomeLayout; key: string } {
  if (kind === 'team') return { layout: { ...layout, team: true }, key: 'team' }
  if (kind === 'pulls' || kind === 'ci') {
    const card = {
      id,
      kind,
      repos: github?.repos ?? [],
      statuses: github?.statuses ?? [kind === 'pulls' ? 'open' : 'failed'],
    } as HomeGithubCard

    return { layout: { ...layout, github: [...layout.github, card] }, key: `gh:${id}` }
  }
  const card: HomeMetricCard = { id, kind, range: '7d', scope: 'me' }

  return {
    layout: { ...layout, metrics: [...(layout.metrics ?? []), card] },
    key: metricKey(card),
  }
}
