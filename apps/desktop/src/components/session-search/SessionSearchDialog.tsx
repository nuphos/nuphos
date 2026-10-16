import { Dialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { MessageSquare, Search, UserRound, Users, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { api } from '../../api'
import { useSuspendTitlebarDrag } from '../../hooks/useSuspendTitlebarDrag'
import { useDebouncedValue } from '../agent/panel/historyPageHooks'
import { InputGroup, InputGroupInput } from '../ui/input-group'
import { Kbd } from '../ui/kbd'

import { SearchResults } from './SearchResults'

import type { TeamMember } from '../../types'

type Props = {
  teamId: string
  teamName: string
  userId: string
  onClose: () => void
  onOpen: (sessionId: string, beside: boolean) => void
  onCommand: (id: string) => void
}

/** Unmounted on close/team change, so a workspace never inherits another search. */
export function SessionSearchDialog({
  teamId,
  teamName,
  userId,
  onClose,
  onOpen,
  onCommand,
}: Props) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'sessions' | 'people'>('sessions')
  const [owner, setOwner] = useState<TeamMember | null>(null)
  const debouncedQuery = useDebouncedValue(query, 200)
  const searchQuery = query.trim() ? debouncedQuery : ''
  const inputRef = useRef<HTMLInputElement>(null)
  const members = useRef<Promise<TeamMember[]> | null>(null)
  const loadPeople = useCallback(() => {
    members.current ??= api.atlasListTeamMembers(teamId).catch((error: unknown) => {
      members.current = null
      throw error
    })

    return members.current
  }, [teamId])

  useSuspendTitlebarDrag(true)

  function choosePerson(person: TeamMember) {
    setOwner(person)
    setMode('sessions')
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50" />
        <Dialog.Viewport className="titlebar-no-drag fixed inset-0 z-[1001] flex items-start justify-center px-4 pt-[min(15vh,138px)] pb-6">
          <Dialog.Popup
            initialFocus={inputRef}
            className="flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-main bg-elevated text-main shadow-[0_18px_50px_#00000066] outline-none"
            onKeyDownCapture={(event) => {
              if (event.key === 'Escape' && mode === 'people' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.stopPropagation()
                setMode('sessions')
                setQuery('')
                inputRef.current?.focus()
              }
            }}
          >
            <Dialog.Title className="sr-only">Search sessions and people</Dialog.Title>
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-main px-4">
              <InputGroup className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-2">
                <Search size={18} className="shrink-0 text-secondary" />
                <InputGroupInput
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxLength={200}
                  role="combobox"
                  aria-expanded
                  aria-autocomplete="list"
                  aria-label={mode === 'people' ? 'Search people' : 'Search sessions'}
                  placeholder={
                    mode === 'people' ? 'Search people…' : 'Search sessions, people or pages…'
                  }
                  className="text-base text-main placeholder:text-secondary"
                />
              </InputGroup>
              <Dialog.Close
                aria-label="Close search"
                className="rounded focus-visible:outline focus-visible:outline-2"
              >
                <Kbd combo="esc" />
              </Dialog.Close>
            </div>
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-main px-3">
              {(['sessions', 'people'] as const).map((value) => {
                const Icon = value === 'people' ? Users : MessageSquare

                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value)
                      inputRef.current?.focus()
                    }}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2',
                      mode === value
                        ? 'bg-zGray-750 font-medium text-main'
                        : 'text-secondary hover:bg-zGray-800',
                    )}
                  >
                    <Icon size={15} />
                    {value === 'people' ? 'People' : 'Sessions'}
                  </button>
                )
              })}
              <span className="flex-1" />
              {owner && mode === 'sessions' ? (
                <button
                  aria-label={`Clear person filter: ${owner.name || owner.email}`}
                  onClick={() => {
                    setOwner(null)
                    inputRef.current?.focus()
                  }}
                  className="flex max-w-[45%] items-center gap-1.5 rounded-md bg-zViolet-500/15 px-2 py-1 text-xs text-main"
                >
                  <UserRound size={14} className="shrink-0" />
                  <span className="truncate">{owner.name || owner.email}</span>
                  <X size={12} className="shrink-0" />
                </button>
              ) : (
                <span className="truncate text-xs text-secondary">{teamName}</span>
              )}
            </div>
            <SearchResults
              key={JSON.stringify([teamId, mode, owner?.id, searchQuery])}
              teamId={teamId}
              teamName={teamName}
              userId={userId}
              loadPeople={loadPeople}
              mode={mode}
              query={searchQuery}
              owner={owner}
              inputRef={inputRef}
              pending={query.trim() !== searchQuery}
              onChoosePerson={choosePerson}
              onOpen={onOpen}
              onCommand={onCommand}
            />
            <div className="flex h-8 shrink-0 items-center gap-2 border-t border-main px-4 text-[11px] text-secondary">
              <span>Navigate</span>
              <Kbd combo="up" />
              <Kbd combo="down" />
              <span className="ml-2">Select</span>
              <Kbd combo="enter" />
              <span className="flex-1" />
              <span className="hidden sm:inline">
                {mode === 'people' ? 'Back to sessions' : 'Open beside'}
              </span>
              <Kbd combo={mode === 'people' ? 'esc' : 'mod+enter'} />
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
