import { ArrowDown, ArrowUpRight, CircleHelp, Keyboard, Palette } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { DevPalette } from '../../devtools/palette'
import { t } from '../../i18n'
import { CHANGELOG_INDEX_URL } from '../../lib/whatsNew'
import { ConfirmDialog } from '../ConfirmDialog'
import { Kbd } from '../ui/kbd'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../ui/menu'
import { StatusDot } from '../ui/status-dot'
import { useChangelog } from '../useChangelog'
import { useReadyUpdate } from '../useReadyUpdate'
import { WhatsNewReader } from '../WhatsNewReader'

import { UpdatePill } from './update-pill'

import type { ChangelogEntry } from '../../types/team'
import type { ReadyUpdate } from '../readyUpdate'

function shortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)

  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function TimelineDot() {
  return (
    <span className="relative z-10 flex h-4 w-4 items-center justify-center">
      <span className="h-[7px] w-[7px] rounded-full border border-line-control bg-main" />
    </span>
  )
}

function WhatsNewGroup({
  entries,
  onOpenEntry,
}: {
  entries: ChangelogEntry[]
  onOpenEntry: (entry: ChangelogEntry) => void
}) {
  return (
    <MenuGroup>
      <MenuGroupLabel>{t("What's new")}</MenuGroupLabel>
      <div className="relative">
        <span
          aria-hidden
          className="absolute bottom-4 top-4 left-[17.5px] border-l border-line-control"
        />
        {entries.slice(0, 3).map((entry) => (
          <MenuItem
            key={entry.slug}
            icon={<TimelineDot />}
            hint={<span className="normal-case tracking-normal">{shortDate(entry.date)}</span>}
            onClick={() => onOpenEntry(entry)}
          >
            <span className="block truncate">{entry.title}</span>
          </MenuItem>
        ))}
        <MenuItem
          icon={<TimelineDot />}
          hint={<ArrowUpRight className="h-3.5 w-3.5" />}
          onClick={() => void api.appOpenExternal(CHANGELOG_INDEX_URL)}
        >
          {t('Full changelog')}
        </MenuItem>
      </div>
    </MenuGroup>
  )
}

/** The update a restart installs, its download while a newer one replaces it, and
 * the installer when the last restart came back without it. */
function UpdateItems({ update, onUpdate }: { update: ReadyUpdate; onUpdate: () => void }) {
  const { installerUrl } = update

  return (
    <>
      {update.percent === null ? (
        <MenuItem icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={onUpdate}>
          {t('Restart to update to {version}', { version: update.version })}
        </MenuItem>
      ) : (
        <MenuItem
          icon={<ArrowDown className="h-3.5 w-3.5" />}
          hint={<span className="tabular-nums">{update.percent}%</span>}
          disabled
        >
          {t('Downloading Nuphos {version}…', { version: update.version })}
        </MenuItem>
      )}
      {installerUrl && (
        <MenuItem
          icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          onClick={() => void api.appOpenExternal(installerUrl)}
        >
          {t('Download installer')}
        </MenuItem>
      )}
    </>
  )
}

export function SidebarHelpMenu({ onOpenShortcutsHelp }: { onOpenShortcutsHelp?: () => void }) {
  const changelog = useChangelog()
  const update = useReadyUpdate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const askToUpdate = () => setAsking(true)

  // A newer release that starts downloading takes the offer back until it is ready.
  if (asking && update?.percent !== null) setAsking(false)

  return (
    <>
      {update && <UpdatePill update={update} onUpdate={askToUpdate} />}
      <Menu
        onOpenChange={(open) => {
          if (open) changelog.markSeen()
        }}
      >
        <MenuTrigger
          className="titlebar-no-drag relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-tertiary outline-none transition-colors hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary data-[popup-open]:bg-[var(--sidebar-overlay-active)]"
          aria-label={t('Help')}
          title={t('Help')}
        >
          <CircleHelp className="h-4 w-4" strokeWidth={1.8} />
          {changelog.unread && (
            <StatusDot tone="unread" label={t("What's new")} className="absolute right-0 top-0" />
          )}
        </MenuTrigger>
        <MenuContent side="top" align="end" sideOffset={8} className="w-[300px]">
          {update && (
            <>
              <UpdateItems update={update} onUpdate={askToUpdate} />
              <MenuSeparator />
            </>
          )}
          {changelog.entries.length > 0 && (
            <>
              <WhatsNewGroup entries={changelog.entries} onOpenEntry={changelog.openEntry} />
              <MenuSeparator />
            </>
          )}
          {onOpenShortcutsHelp && (
            <MenuItem
              icon={<Keyboard className="h-3.5 w-3.5" />}
              hint={<Kbd combo="mod+/" />}
              onClick={() => onOpenShortcutsHelp()}
            >
              {t('Keyboard shortcuts')}
            </MenuItem>
          )}
          {import.meta.env.DEV && (
            <MenuItem
              icon={<Palette className="h-3.5 w-3.5" />}
              onClick={() => setPaletteOpen((open) => !open)}
            >
              Color palette (dev)
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {update && (
        <ConfirmDialog
          open={asking}
          title={t('Update ready')}
          description={t(
            'Restart to finish installing Nuphos {version}. Bots and tasks on this computer stop, so replies still running there are cut off.',
            { version: update.version },
          )}
          confirmLabel={t('Update')}
          cancelLabel={t('Not now')}
          onConfirm={update.install}
          onClose={() => setAsking(false)}
        />
      )}
      {changelog.readerEntry && (
        <WhatsNewReader entry={changelog.readerEntry} onClose={changelog.closeReader} />
      )}
      {import.meta.env.DEV && (
        <DevPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      )}
    </>
  )
}
