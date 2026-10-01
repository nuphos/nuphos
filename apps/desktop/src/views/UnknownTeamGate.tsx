import { TriangleAlert } from 'lucide-react'

import { Avatar } from '../components/Avatar'
import { Button } from '../components/ui/button'

import type { AtlasTeam } from '../types'

/**
 * Full-window stop for a workspace scoped to a team this account is not a
 * member of — a tab restored from a deleted team, membership revoked
 * mid-session, or a link carrying an id that was never a team.
 *
 * It takes over the window rather than letting the affected tab render, because
 * the failure is not confined to that tab: the team picker has no name to show
 * for it, every request it makes is rejected, and a listing that quietly widens
 * its scope answers with another team's data. Switching tabs used to hide all
 * of that. Recovery is picking a workspace — which rebuilds the tab strip
 * around one team — or reloading, for a list that is merely stale.
 */
export function UnknownTeamGate({
  teams,
  reloading,
  onReload,
  onSwitchTeam,
  onSignOut,
}: {
  teams: AtlasTeam[]
  reloading: boolean
  onReload: () => void
  onSwitchTeam: (teamId: string) => void
  onSignOut: () => void
}) {
  return (
    <div className="flex h-full flex-col text-main overflow-hidden bg-main">
      {/* Draggable window strip (also clears the macOS traffic lights). */}
      <div className="titlebar-drag h-[44px] flex-shrink-0 border-b border-zGray-800/60" />
      <div className="flex-1 overflow-auto flex flex-col items-center px-4">
        <div className="my-auto flex w-full max-w-[420px] flex-col items-center gap-5 py-10">
          <TriangleAlert className="h-6 w-6 text-error" strokeWidth={1.8} />
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-[15px] font-medium text-main">This workspace is unavailable</h1>
            <p className="text-[13px] text-tertiary">
              A tab is open on a workspace this account can’t access. Pick one below to continue.
            </p>
          </div>

          {teams.length > 0 && (
            <div className="w-full sketch-line-h">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => onSwitchTeam(team.id)}
                  className="sketch-divider-bottom flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-zGray-800/60 focus-visible:bg-zGray-800/60"
                >
                  <Avatar
                    src={team.avatarUrl}
                    name={team.name}
                    size={22}
                    className="rounded-md !shadow-none"
                  />
                  <span className="truncate text-[13px] text-main">{team.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onReload} disabled={reloading}>
              {reloading ? 'Reloading…' : 'Reload workspaces'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              Log out
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
