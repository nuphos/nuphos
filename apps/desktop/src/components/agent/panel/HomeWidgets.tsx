import { CircleDot, GitPullRequest, LayoutGrid } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../ui/menu'

import { addCard } from './homeAddCard'
import { DelayedPanelReveal } from './homeAnimation'
import { isKnownCard, teamCardHeight } from './homeCardCatalog'
import { HomeCardGallery } from './homeCardGallery'
import { GithubCard } from './homeCards'
import { AddCardButton } from './homeGalleryParts'
import { HomeGrid } from './homeGrid'
import { HomeMetricCard } from './homeMetricLive'
import { MetricsSubmenu } from './homeMetricPicker'
import { DashboardPanelCard } from './homePanelCard'
import { DashboardPanelsSubmenu } from './homePanelPicker'
import { TeamActivityCard } from './homeTeamCard'
import {
  GRID_COLUMNS,
  HOME_GRID_VERSION,
  cardLabel,
  fitOldSizes,
  metricKey,
  panelKey,
  toggleItem,
} from './homeWidgetSettings'
import { useHomeLayout } from './useHomeLayout'
import { useTeamSize } from './useTeamSize'

import type { HomeCardKind } from './homeCardCatalog'
import type {
  HomeGithubCard,
  HomeLayout,
  HomeMetricCard as Metric,
  HomePanel,
} from './homeWidgetSettings'

const newId = () => crypto.randomUUID().slice(0, 8)

// Saved with the sizes as fitted, so a card resized back to an old default stays so.
const versioned = (next: HomeLayout): HomeLayout => ({ ...next, gridVersion: HOME_GRID_VERSION })

/**
 * The configurable cards under the home composer, picked in "Customize":
 * team activity on or off, any number of pull request and CI cards (each set
 * up from its own ⋯ menu), metric cards about the agents' work, and every
 * pinned dashboard panel as a card.
 * Team activity is left out while the user is the team's only member.
 */
export function HomeWidgets({
  teamId,
  isTeamAdmin = false,
  onOpenConversation,
  onOpenNuphosLink,
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
  onOpenNuphosLink?: (href: string) => boolean
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  const home = useHomeLayout(teamId)
  const [galleryOpen, setGalleryOpen] = useState(false)
  // Null until the team's size is first known on this machine.
  const members = useTeamSize(teamId)
  const hasTeammates = (members ?? 0) > 1
  const teamHeight = teamCardHeight(members ?? 2)

  if (!home.layout) return null
  // Until the team's size is known, team activity keeps the size it was saved at.
  const settings = fitOldSizes(home.layout, members === null ? 8 : teamHeight)
  // Saved without the new grid version until the team's size is known, so team activity still fits.
  const update = (next: HomeLayout) => home.update(members === null ? next : versioned(next))
  const setGithub = (github: HomeGithubCard[]) => update({ ...settings, github })
  const addGithub = (card: HomeGithubCard) => setGithub([...settings.github, card])
  const metrics = settings.metrics ?? []
  const setMetrics = (next: Metric[]) => update({ ...settings, metrics: next })
  const togglePanel = (pin: HomePanel) =>
    update({ ...settings, panels: toggleItem(settings.panels, pin, panelKey) })
  const add = (kind: HomeCardKind) => {
    if (kind !== 'panel') update(addCard(settings, kind, newId()).layout)
  }

  const cards = [
    // Shown while the members load, as its skeleton, so it does not appear late.
    settings.team && (hasTeammates || members === null) && (
      <TeamActivityCard key="team" teamId={teamId} onOpenConversation={onOpenConversation} />
    ),
    // Cards of a kind this desktop does not know, saved by a newer one, are left out.
    ...settings.github
      .filter(isKnownCard)
      .map((card) => (
        <GithubCard
          key={`gh:${card.id}`}
          teamId={teamId}
          onOpenNuphosLink={onOpenNuphosLink}
          card={card}
          onChange={(next) => setGithub(settings.github.map((c) => (c.id === card.id ? next : c)))}
          onRemove={() => setGithub(settings.github.filter((c) => c.id !== card.id))}
        />
      )),
    ...metrics
      .filter(isKnownCard)
      .map((card) => (
        <HomeMetricCard
          key={metricKey(card)}
          teamId={teamId}
          card={card}
          hasTeammates={hasTeammates}
          onChange={(next) => setMetrics(metrics.map((c) => (c.id === card.id ? next : c)))}
          onRemove={() => setMetrics(metrics.filter((c) => c.id !== card.id))}
          onOpenConversation={onOpenConversation}
        />
      )),
    ...settings.panels.map((pin) => (
      <DashboardPanelCard
        key={`panel:${panelKey(pin)}`}
        teamId={teamId}
        onOpenNuphosLink={onOpenNuphosLink}
        pin={pin}
        onUnpin={() => togglePanel(pin)}
      />
    )),
  ].filter((card) => card !== false)

  return (
    <div className="group/home mb-6">
      {cards.length > 0 && (
        <HomeGrid
          cards={cards}
          saved={settings.grid}
          sizes={{ team: { w: GRID_COLUMNS, h: teamHeight } }}
          onChange={(grid) => update({ ...settings, grid })}
          label={(key) => cardLabel(settings, key)}
          revealAt={revealAt}
          replayKey={replayKey}
        />
      )}
      <DelayedPanelReveal
        replayKey={replayKey}
        // Below the cards, after the last of them has slid in.
        delayMs={revealAt + 150 * cards.length}
        className="mt-3 flex flex-col items-center gap-2"
      >
        <AddCardButton subtle={cards.length > 0} onClick={() => setGalleryOpen(true)} />
        <HomeCardGallery
          teamId={teamId}
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          layout={settings}
          hasTeammates={hasTeammates}
          customized={home.customized}
          isTeamAdmin={isTeamAdmin}
          onAdd={add}
          onRemove={(kind) => {
            if (kind === 'team') update({ ...settings, team: false })
          }}
          onTogglePanel={togglePanel}
          onReset={home.resetToTeamDefault}
          onSetTeamDefault={() => home.setAsTeamDefault(versioned(settings))}
        />
        <Menu>
          <MenuTrigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main">
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('Customize')}
          </MenuTrigger>
          <MenuContent align="center" className="w-[232px]">
            {hasTeammates && (
              <MenuCheckboxItem
                checked={settings.team}
                onCheckedChange={(team) => update({ ...settings, team })}
              >
                {t('Team activity')}
              </MenuCheckboxItem>
            )}
            <MenuItem
              icon={<GitPullRequest className="h-3.5 w-3.5" strokeWidth={1.8} />}
              onClick={() =>
                addGithub({ id: newId(), kind: 'pulls', repos: [], statuses: ['open'] })
              }
            >
              {t('Add pull requests card')}
            </MenuItem>
            <MenuItem
              icon={<CircleDot className="h-3.5 w-3.5" strokeWidth={1.8} />}
              onClick={() =>
                addGithub({ id: newId(), kind: 'ci', repos: [], statuses: ['failed'] })
              }
            >
              {t('Add CI card')}
            </MenuItem>
            <MetricsSubmenu
              onAdd={(kind) =>
                setMetrics([...metrics, { id: newId(), kind, range: '7d', scope: 'me' }])
              }
            />
            <DashboardPanelsSubmenu
              teamId={teamId}
              selected={settings.panels}
              onToggle={togglePanel}
            />
            <MenuSeparator />
            <MenuItem disabled={!home.customized} onClick={home.resetToTeamDefault}>
              {t('Reset to team default')}
            </MenuItem>
            {isTeamAdmin && (
              <MenuItem onClick={() => home.setAsTeamDefault(versioned(settings))}>
                {t('Set as team default')}
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </DelayedPanelReveal>
    </div>
  )
}
