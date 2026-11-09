import { Dialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { Search, UserRound, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useSuspendTitlebarDrag } from '../../hooks/useSuspendTitlebarDrag'
import { t } from '../../i18n'
import { trackSearch } from '../../lib/searchAnalytics'
import { useDebouncedValue } from '../agent/panel/historyPageHooks'
import { InputGroup, InputGroupInput } from '../ui/input-group'
import { Kbd } from '../ui/kbd'
import { Tooltip } from '../ui/tooltip'

import { SearchResults } from './SearchResults'
import { takeSearchSource } from './searchSource'

import type { TeamMember } from '../../types'

type Props = {
  teamId: string
  teamName: string
  otherTeams?: { id: string; name: string }[]
  userId: string
  /** The parent's open state; when it turns false the dialog plays its closing transition first. */
  open: boolean
  /** Asks the parent to close (Escape, a click outside). */
  onClose: () => void
  /** The closing transition has finished; the parent can unmount now. */
  onExited: () => void
  onOpen: (sessionId: string, beside: boolean) => void
  onCommand: (id: string) => void
}

/** Unmounted on close/team change, so a workspace never inherits another search. */
export function SessionSearchDialog({
  teamId,
  teamName,
  otherTeams,
  userId,
  open,
  onClose,
  onExited,
  onOpen,
  onCommand,
}: Props) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'sessions' | 'people'>('sessions')
  const [owner, setOwner] = useState<TeamMember | null>(null)
  const debouncedQuery = useDebouncedValue(query, 200)
  const searchQuery = query.trim() ? debouncedQuery : ''
  const inputRef = useRef<HTMLInputElement>(null)
  // Closing hands focus back to where it was, but not to the Search button
  // (its ring and tooltip would light up) and not once a result took the user elsewhere.
  const [focusedBefore] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  )
  const navigated = useRef(false)
  const finalFocus = () =>
    !navigated.current &&
    focusedBefore?.isConnected === true &&
    !focusedBefore.closest('[data-search-trigger]')
      ? focusedBefore
      : false
  // Open one frame after mount so the opening transition plays.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true))

    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => {
    if (open) trackSearch('search_opened', { source: takeSearchSource() })
  }, [open])
  // Closed again before it ever opened: there is no transition to wait for.
  useEffect(() => {
    if (!open && !ready) onExited()
  }, [open, ready, onExited])
  const members = useRef<Promise<TeamMember[]> | null>(null)
  const loadPeople = useCallback(() => {
    members.current ??= api.atlasListTeamMembers(teamId).catch((error: unknown) => {
      members.current = null
      throw error
    })

    return members.current
  }, [teamId])

  useSuspendTitlebarDrag(true)

  function switchMode(next: 'sessions' | 'people') {
    setMode(next)
    setQuery('')
    inputRef.current?.focus()
  }

  function choosePerson(person: TeamMember) {
    setOwner(person)
    setMode('sessions')
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <Dialog.Root
      open={ready && open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onExited()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/25 transition-opacity duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Viewport className="titlebar-no-drag fixed inset-0 z-[1001] flex items-start justify-center px-4 pt-[min(15vh,138px)] pb-6">
          <Dialog.Popup
            initialFocus={inputRef}
            finalFocus={finalFocus}
            className="flex h-[min(520px,100%)] w-full max-w-[640px] flex-col overflow-hidden rounded-[var(--sheet-radius)] bg-elevated text-main shadow-[var(--sheet-shadow),0_24px_48px_-16px_rgba(0,0,0,0.28)] outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0 motion-reduce:transition-none"
            onKeyDownCapture={(event) => {
              // Tab switches between agents and people, so the keyboard reaches both.
              if (event.key === 'Tab' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.stopPropagation()
                switchMode(mode === 'people' ? 'sessions' : 'people')

                return
              }
              // Backspace in an empty query drops the person filter, as a chip in a search field does.
              if (event.key === 'Backspace' && !query && owner && mode === 'sessions') {
                event.preventDefault()
                setOwner(null)

                return
              }
              if (event.key === 'Escape' && mode === 'people' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.stopPropagation()
                setMode('sessions')
                setQuery('')
                inputRef.current?.focus()
              }
            }}
          >
            <Dialog.Title className="sr-only">{t('Search agents and people')}</Dialog.Title>
            {/* One line of text to type in: no box inside the sheet, one hairline under it. */}
            {/* Focus shows as the hairline darkening, not as a box around the query. */}
            <InputGroup className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line-control px-4 focus-within:!ring-0 focus-within:border-line-focus">
              <Search size={17} className="shrink-0 text-tertiary" />
              <InputGroupInput
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={200}
                role="combobox"
                aria-expanded
                aria-autocomplete="list"
                aria-label={mode === 'people' ? t('Search people') : t('Search agents')}
                placeholder={
                  mode === 'people' ? t('Search people…') : t('Search agents, people or pages…')
                }
                className="text-[15px] text-main placeholder:text-tertiary"
              />
              {owner && mode === 'sessions' ? (
                <button
                  aria-label={t('Clear person filter: {name}', {
                    name: owner.name || owner.email,
                  })}
                  onClick={() => {
                    setOwner(null)
                    inputRef.current?.focus()
                  }}
                  className="flex max-w-[40%] shrink-0 items-center gap-1.5 rounded-md bg-state-selected px-2 py-1 text-xs text-main"
                >
                  <UserRound size={14} className="shrink-0" />
                  <span className="truncate">{owner.name || owner.email}</span>
                  <X size={12} className="shrink-0" />
                </button>
              ) : (
                <Tooltip
                  content={
                    <span className="inline-flex items-center gap-1.5">
                      {mode === 'people' ? t('Back to agents') : t('Search people')}{' '}
                      <Kbd combo="tab" />
                    </span>
                  }
                >
                  <button
                    type="button"
                    aria-pressed={mode === 'people'}
                    aria-keyshortcuts="Tab"
                    onClick={() => switchMode(mode === 'people' ? 'sessions' : 'people')}
                    className={clsx(
                      'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2',
                      mode === 'people'
                        ? 'bg-state-selected text-main'
                        : 'text-tertiary hover:bg-state-hover hover:text-main',
                    )}
                  >
                    <Users size={14} />
                    {t('People')}
                  </button>
                </Tooltip>
              )}
            </InputGroup>
            <SearchResults
              key={JSON.stringify([teamId, mode, owner?.id, searchQuery])}
              teamId={teamId}
              teamName={teamName}
              otherTeams={otherTeams}
              userId={userId}
              loadPeople={loadPeople}
              mode={mode}
              query={searchQuery}
              owner={owner}
              inputRef={inputRef}
              pending={query.trim() !== searchQuery}
              onChoosePerson={choosePerson}
              onOpen={(sessionId, beside) => {
                navigated.current = true
                onOpen(sessionId, beside)
              }}
              onCommand={(id) => {
                navigated.current = true
                onCommand(id)
              }}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
