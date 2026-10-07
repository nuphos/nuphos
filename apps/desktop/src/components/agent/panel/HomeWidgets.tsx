import { CircleDot, GitPullRequest, LayoutGrid } from 'lucide-react'

import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../ui/menu'

import { DelayedPanelReveal } from './homeAnimation'
import { GithubCard } from './homeCards'
import { HomeGrid } from './homeGrid'
import { DashboardPanelCard } from './homePanelCard'
import { DashboardPanelsSubmenu } from './homePanelPicker'
import { TeamActivityCard } from './homeTeamCard'
import { panelKey, toggleItem } from './homeWidgetSettings'
import { useHomeLayout } from './useHomeLayout'

import type { HomeGithubCard, HomePanel } from './homeWidgetSettings'

/**
 * The configurable cards under the home composer, picked in "Customize":
 * team activity on or off, any number of pull request and CI cards (each set
 * up from its own ⋯ menu), and every pinned dashboard panel as a card.
 */
export function HomeWidgets({
  teamId,
  isTeamAdmin = false,
  onOpenConversation,
  revealAt,
  replayKey,
}: {
  teamId: string
  /** When the first block slides in; each card after it follows 150ms later. */
  revealAt: number
  /** A new value replays the reveal. */
  replayKey: number
  /** Administrators can make their layout the team default. */
  isTeamAdmin?: boolean
  /** Opens a conversation picked from a card. */
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const home = useHomeLayout(teamId)

  if (!home.layout) return null
  const settings = home.layout
  const update = home.update
  const setGithub = (github: HomeGithubCard[]) => update({ ...settings, github })
  const addGithub = (card: HomeGithubCard) => setGithub([...settings.github, card])
  const newId = () => crypto.randomUUID().slice(0, 8)
  const togglePanel = (pin: HomePanel) =>
    update({ ...settings, panels: toggleItem(settings.panels, pin, panelKey) })

  const cards = [
    settings.team && (
      <TeamActivityCard key="team" teamId={teamId} onOpenConversation={onOpenConversation} />
    ),
    ...settings.github.map((card) => (
      <GithubCard
        key={`gh:${card.id}`}
        teamId={teamId}
        card={card}
        onChange={(next) => setGithub(settings.github.map((c) => (c.id === card.id ? next : c)))}
        onRemove={() => setGithub(settings.github.filter((c) => c.id !== card.id))}
      />
    )),
    ...settings.panels.map((pin) => (
      <DashboardPanelCard
        key={`panel:${panelKey(pin)}`}
        teamId={teamId}
        pin={pin}
        onUnpin={() => togglePanel(pin)}
      />
    )),
  ].filter((card) => card !== false)

  return (
    <div className="mb-6">
      {cards.length > 0 && (
        <HomeGrid
          cards={cards}
          saved={settings.grid}
          onChange={(grid) => update({ ...settings, grid })}
          revealAt={revealAt}
          replayKey={replayKey}
        />
      )}
      <DelayedPanelReveal
        replayKey={replayKey}
        // Below the cards, after the last of them has slid in.
        delayMs={revealAt + 150 * cards.length}
        className="mt-3 flex justify-center"
      >
        <Menu>
          <MenuTrigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main">
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.8} />
            Customize
          </MenuTrigger>
          <MenuContent align="center" className="w-[232px]">
            <MenuCheckboxItem
              checked={settings.team}
              onCheckedChange={(team) => update({ ...settings, team })}
            >
              Team activity
            </MenuCheckboxItem>
            <MenuItem
              icon={<GitPullRequest className="h-3.5 w-3.5" strokeWidth={1.8} />}
              onClick={() => addGithub({ id: newId(), kind: 'pulls', repos: [], status: 'open' })}
            >
              Add pull requests card
            </MenuItem>
            <MenuItem
              icon={<CircleDot className="h-3.5 w-3.5" strokeWidth={1.8} />}
              onClick={() => addGithub({ id: newId(), kind: 'ci', repos: [], status: 'failed' })}
            >
              Add CI card
            </MenuItem>
            <DashboardPanelsSubmenu
              teamId={teamId}
              selected={settings.panels}
              onToggle={togglePanel}
            />
            <MenuSeparator />
            <MenuItem disabled={!home.customized} onClick={home.resetToTeamDefault}>
              Reset to team default
            </MenuItem>
            {isTeamAdmin && (
              <MenuItem onClick={home.setAsTeamDefault}>Set as team default</MenuItem>
            )}
          </MenuContent>
        </Menu>
      </DelayedPanelReveal>
    </div>
  )
}
