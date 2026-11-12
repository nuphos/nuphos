import { Popover } from '@base-ui/react/popover'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { t } from '../../i18n'
import { onChatArchived, onChatUnarchived } from '../../lib/chatArchiveEvents'
import { useArchivedChats } from '../../views/archived-chats/useArchivedChats'
import { Button } from '../ui/button'

import { SidebarSectionList } from './sections-list'

import type { ComponentProps } from 'react'

type Props = { listProps: Omit<ComponentProps<typeof SidebarSectionList>, 'sections'> }

/** Share the first archive page between availability and the expanded list. */
export function SidebarArchiveSection({ listProps }: Props) {
  const [refreshKey, setRefreshKey] = useState(0)
  const teamId = listProps.scope.teamId
  const archive = useArchivedChats({ teamId, filter: '', refreshKey })

  useEffect(() => {
    const refresh = () => setRefreshKey((value) => value + 1)
    const offArchived = onChatArchived((change) => {
      if (change.teamId === teamId) refresh()
    })
    const offUnarchived = onChatUnarchived(refresh)

    return () => {
      offArchived()
      offUnarchived()
    }
  }, [teamId])

  if (archive.items.length === 0 && !archive.failed) return null

  return <ArchivePopover listProps={listProps} archive={archive} />
}

type ArchiveProps = Props & { archive: ReturnType<typeof useArchivedChats> }

function ArchivePopover({ listProps, archive }: ArchiveProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const observeHeight = useCallback((element: HTMLDivElement | null) => {
    const page = anchor.current?.closest<HTMLElement>('.sidebar-page-layout')

    if (!element || !page) return
    const update = () =>
      page.style.setProperty(
        '--sidebar-archive-height',
        `${String(element.getBoundingClientRect().height)}px`,
      )
    const observer = new ResizeObserver(update)

    observer.observe(element)
    update()

    return () => observer.disconnect()
  }, [])
  const [open, setOpen] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)

  return (
    <div ref={anchor} data-archive-expanded={open || panelVisible ? 'true' : undefined}>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setPanelVisible(true)
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setPanelVisible(false)
        }}
      >
        <Popover.Trigger
          style={{ opacity: open || panelVisible ? 0 : 1 }}
          className="flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-tertiary hover:text-secondary"
        >
          {t('Archived')}
          <ChevronRight className="size-3" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={-28} className="z-[1000]">
            <Popover.Popup
              ref={observeHeight}
              className="sidebar-archive-overlay flex max-h-[var(--available-height)] w-[var(--anchor-width)] flex-col outline-none"
            >
              <Popover.Close
                aria-expanded={open}
                className="flex h-7 w-full shrink-0 items-center gap-1.5 px-2 text-[13px] font-medium text-tertiary hover:text-secondary"
              >
                <Popover.Title render={<span />}>{t('Archived')}</Popover.Title>
                <ChevronDown className="size-3" />
              </Popover.Close>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2 scrollbar-thin">
                <ArchiveItems
                  archive={archive}
                  listProps={{
                    ...listProps,
                    onSelect: (key) => {
                      setOpen(false)
                      listProps.onSelect(key)
                    },
                  }}
                />
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

function ArchiveItems({ listProps, archive }: ArchiveProps) {
  return (
    <>
      <SidebarSectionList
        {...listProps}
        sections={[
          {
            compact: true,
            loading: archive.loading,
            items: archive.items.map((chat) => ({
              key: `agent-session:${chat.sessionId}`,
              label: chat.title || chat.firstMessage || t('Untitled agent'),
              enabled: true,
              task: true,
              readOnlyChat: true,
            })),
          },
        ]}
      />
      {archive.failed && (
        <Button variant="ghost" size="sm" onClick={archive.retry}>
          {t('Retry')}
        </Button>
      )}
      {archive.hasMore && (
        <Button
          variant="ghost"
          size="sm"
          disabled={archive.loadingMore}
          onClick={() => void archive.loadMore()}
        >
          {t('Load more')}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => listProps.onSelect('team.archived-chats')}>
        {t('View all')}
      </Button>
    </>
  )
}
