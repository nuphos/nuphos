import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import { Button } from '../../components/ui/button'

import { ColorDot, LinearPageMessage } from './linearParts'
import { LinearReconnectPrompt } from './LinearReconnect'
import { useLinearTeams } from './useLinearTeams'

import type { LinearWorkspaceTeams } from './useLinearTeams'
import type { LinearTeamSummary } from '../../types'

type Props = {
  teamId: string
  filter: string
  refreshKey: number
  onCount: (count: number) => void
  onOpenTeam: (bindingId: string, team: LinearTeamSummary) => void
  onOpenConnectors: () => void
}

function filterGroups(groups: LinearWorkspaceTeams[], filter: string): LinearWorkspaceTeams[] {
  const needle = filter.trim().toLowerCase()

  if (!needle) return groups

  return groups
    .map((group) =>
      group.workspace.workspaceName.toLowerCase().includes(needle)
        ? group
        : {
            ...group,
            teams: group.teams.filter(
              (team) =>
                team.name.toLowerCase().includes(needle) || team.key.toLowerCase().includes(needle),
            ),
          },
    )
    .filter((group) => group.teams.length > 0)
}

function TeamRow({ team, onOpen }: { team: LinearTeamSummary; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-zGray-800/50"
      >
        <ColorDot color={team.color} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">
          {team.name}
        </span>
        <span className="shrink-0 text-[12px] text-tertiary">{team.key}</span>
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-tertiary opacity-0 group-hover:opacity-100"
          strokeWidth={1.8}
        />
      </button>
    </li>
  )
}

function workspaceNote(group: LinearWorkspaceTeams): string | null {
  if (group.status === 'no-access') return "You don't have access to this workspace."
  if (group.status === 'error') return 'Teams could not be loaded.'

  return group.teams.length === 0 ? 'No teams.' : null
}

type WorkspaceSectionProps = {
  teamId: string
  group: LinearWorkspaceTeams
  showHeading: boolean
  onOpenTeam: Props['onOpenTeam']
  onReconnected: () => void
}

function WorkspaceBody({ teamId, group, onOpenTeam, onReconnected }: WorkspaceSectionProps) {
  if (group.status === 'reconnect') {
    return (
      <LinearReconnectPrompt
        teamId={teamId}
        onReconnected={onReconnected}
        className="flex flex-col items-start gap-2 px-2 py-2"
      />
    )
  }
  const note = workspaceNote(group)

  if (note) return <div className="px-2 py-2 text-[12.5px] text-tertiary">{note}</div>

  return (
    <ul>
      {group.teams.map((team) => (
        <TeamRow key={team.id} team={team} onOpen={() => onOpenTeam(group.workspace.id, team)} />
      ))}
    </ul>
  )
}

function WorkspaceSection(props: WorkspaceSectionProps) {
  return (
    <section className="space-y-1">
      {props.showHeading && (
        <h2 className="px-2 text-[12px] font-medium text-tertiary">
          {props.group.workspace.workspaceName}
        </h2>
      )}
      <WorkspaceBody {...props} />
    </section>
  )
}

export function LinearTeamsView({
  teamId,
  filter,
  refreshKey,
  onCount,
  onOpenTeam,
  onOpenConnectors,
}: Props) {
  const { state, reload } = useLinearTeams(teamId, refreshKey)
  const groups = useMemo(
    () => (state.kind === 'loaded' ? filterGroups(state.groups, filter) : []),
    [state, filter],
  )
  const count = groups.reduce((sum, group) => sum + group.teams.length, 0)

  useEffect(() => onCount(count), [count, onCount])

  if (state.kind === 'loading') return <LinearPageMessage>Loading…</LinearPageMessage>
  if (state.kind === 'error') {
    return <LinearPageMessage>Linear could not be loaded.</LinearPageMessage>
  }
  if (state.groups.length === 0) {
    return (
      <LinearPageMessage>
        No Linear workspace is connected to this team.
        <Button variant="secondary" size="sm" onClick={onOpenConnectors}>
          Open Connectors
        </Button>
      </LinearPageMessage>
    )
  }
  if (groups.length === 0) return <LinearPageMessage>No teams match “{filter}”.</LinearPageMessage>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl space-y-5 px-2 py-3 @xl:px-4 @xl:py-5">
        {groups.map((group) => (
          <WorkspaceSection
            key={group.workspace.id}
            teamId={teamId}
            group={group}
            showHeading={state.groups.length > 1}
            onOpenTeam={onOpenTeam}
            onReconnected={reload}
          />
        ))}
      </div>
    </div>
  )
}
