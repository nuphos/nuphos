import { LinearIssueView } from '../LinearIssueView'

import { LinearTeamIssuesView } from './LinearTeamIssuesView'
import { LinearTeamsView } from './LinearTeamsView'

import type { LinearNavState } from '../../lib/app-routes/types'

type Props = {
  teamId: string
  nav: LinearNavState
  onNavChange: (nav: LinearNavState) => void
  filter: string
  refreshKey: number
  onCount: (count: number) => void
  onOpenConnectors: () => void
}

export function LinearView({
  teamId,
  nav,
  onNavChange,
  filter,
  refreshKey,
  onCount,
  onOpenConnectors,
}: Props) {
  if (nav.view === 'issue') {
    const { bindingId, identifier } = nav

    return (
      <LinearIssueView
        key={`${teamId}:${bindingId}:${identifier}`}
        teamId={teamId}
        bindingId={bindingId}
        identifier={identifier}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoaded={(issue) =>
          onNavChange({
            view: 'issue',
            bindingId,
            identifier,
            title: issue.title,
            url: issue.url,
            team: issue.team,
          })
        }
      />
    )
  }
  if (nav.view === 'team') {
    const { bindingId } = nav

    return (
      <LinearTeamIssuesView
        key={`${teamId}:${bindingId}:${nav.team.id}`}
        teamId={teamId}
        bindingId={bindingId}
        linearTeamId={nav.team.id}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoaded={(team) => onNavChange({ view: 'team', bindingId, team })}
        onOpenIssue={(issue, team) =>
          onNavChange({
            view: 'issue',
            bindingId,
            identifier: issue.identifier,
            title: issue.title,
            url: issue.url,
            team,
          })
        }
      />
    )
  }

  return (
    <LinearTeamsView
      key={teamId}
      teamId={teamId}
      filter={filter}
      refreshKey={refreshKey}
      onCount={onCount}
      onOpenTeam={(bindingId, team) =>
        onNavChange({
          view: 'team',
          bindingId,
          team: { id: team.id, key: team.key, name: team.name, url: team.url },
        })
      }
      onOpenConnectors={onOpenConnectors}
    />
  )
}
