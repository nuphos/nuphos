import clsx from 'clsx'
import { ArrowDown, ArrowUpRight, CircleHelp, Keyboard, Palette } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { DevPalette } from '../../devtools/palette'
import { CHANGELOG_INDEX_URL } from '../../lib/whatsNew'
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
import { useChangelog } from '../useChangelog'
import { useReadyUpdate } from '../useReadyUpdate'
import { WhatsNewReader } from '../WhatsNewReader'

import type { ChangelogEntry } from '../../types/team'

function shortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)

  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function TimelineDot() {
  return (
    <span className="relative z-10 flex h-4 w-4 items-center justify-center">
      <span className="h-[7px] w-[7px] rounded-full border border-zGray-500 bg-main" />
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
      <MenuGroupLabel>What&apos;s new</MenuGroupLabel>
      <div className="relative">
        <span
          aria-hidden
          className="absolute bottom-4 top-4 left-[17.5px] border-l border-zGray-700"
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
          Full changelog
        </MenuItem>
      </div>
    </MenuGroup>
  )
}

export function SidebarHelpMenu({ onOpenShortcutsHelp }: { onOpenShortcutsHelp?: () => void }) {
  const changelog = useChangelog()
  const update = useReadyUpdate()
  const [paletteOpen, setPaletteOpen] = useState(false)

  return (
    <>
      <Menu
        onOpenChange={(open) => {
          if (open) changelog.markSeen()
        }}
      >
        <MenuTrigger
          className={clsx(
            'titlebar-no-drag relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full outline-none transition-colors',
            update
              ? 'update-notif-enter bg-zViolet-500 text-white shadow-sm shadow-zViolet-900/40 hover:bg-zViolet-400'
              : 'text-tertiary hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary data-[popup-open]:bg-[var(--sidebar-overlay-active)]',
          )}
          aria-label={update ? `Update ready — version ${update.version}` : 'Help'}
          title={update ? `Update ready — version ${update.version}` : 'Help'}
        >
          {update ? (
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.4} />
          ) : (
            <CircleHelp className="h-4 w-4" strokeWidth={1.8} />
          )}
          {!update && changelog.unread && (
            <span className="absolute right-0 top-0 h-2 w-2 rounded-full border border-main bg-red-500" />
          )}
        </MenuTrigger>
        <MenuContent side="top" align="end" sideOffset={8} className="w-[300px]">
          {update && (
            <>
              <MenuItem icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={update.install}>
                Restart to update to {update.version}
              </MenuItem>
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
              Keyboard shortcuts
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
      {changelog.readerEntry && (
        <WhatsNewReader entry={changelog.readerEntry} onClose={changelog.closeReader} />
      )}
      {import.meta.env.DEV && (
        <DevPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      )}
    </>
  )
}
