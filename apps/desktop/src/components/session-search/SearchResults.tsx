import { useEffect, useId, useMemo, useState } from 'react'

import { t } from '../../i18n'
import { isMac } from '../../lib/platform'
import { searchKeyAction } from '../../lib/searchKeyboard'
import { searchMatch } from '../../lib/searchMatch'
import { AgentAvatar } from '../agent/AgentAvatar'
import { relativeTimeFromNow } from '../agent/panel/textUtils'
import { Avatar } from '../Avatar'

import { PaletteCommandRows } from './PaletteCommandRows'
import { matchPaletteCommands } from './paletteCommands'
import { SearchResultRow } from './SearchResultRow'
import { useSearchResults } from './useSearchResults'

import type { SessionResult } from './useSearchResults'
import type { TeamMember } from '../../types'
import type { RefObject } from 'react'

function subtitleFor({ conversation, openedAt }: SessionResult) {
  const vars = {
    owner: conversation.owner?.name || conversation.owner?.email || t('Unknown member'),
    time: relativeTimeFromNow(
      openedAt ? new Date(openedAt).toISOString() : conversation.lastActiveAt,
    ),
  }

  return openedAt ? t('{owner} · Opened {time}', vars) : t('{owner} · Updated {time}', vars)
}

export function SearchResults({
  teamId,
  userId,
  teamName,
  otherTeams = [],
  mode,
  query,
  owner,
  inputRef,
  pending,
  loadPeople,
  onChoosePerson,
  onOpen,
  onCommand,
}: {
  teamId: string
  userId: string
  teamName: string
  /** Teams ⌘K can switch to, as "Switch to …" actions. */
  otherTeams?: { id: string; name: string }[]
  mode: 'sessions' | 'people'
  query: string
  owner: TeamMember | null
  inputRef: RefObject<HTMLInputElement | null>
  pending: boolean
  loadPeople: () => Promise<TeamMember[]>
  onChoosePerson: (person: TeamMember) => void
  onOpen: (sessionId: string, beside: boolean) => void
  onCommand: (id: string) => void
}) {
  const results = useSearchResults(teamId, userId, mode, query, loadPeople, owner?.id)
  const [selected, setSelected] = useState(0)
  const listId = useId()
  const commands = useMemo(
    () => (mode === 'sessions' && !owner ? matchPaletteCommands(query, otherTeams) : []),
    [mode, owner, query, otherTeams],
  )
  const resultCount = mode === 'people' ? results.people.length : results.sessions.length
  const busy = pending || results.loading
  // Commands are local, so they stay usable while only the sessions load.
  const count = commands.length + (busy ? 0 : resultCount)
  const selectedIndex = Math.min(selected, Math.max(0, count - 1))
  const activeId = count > 0 ? `${listId}-${selectedIndex}` : undefined

  useEffect(() => {
    const input = inputRef.current

    if (!input) return
    input.setAttribute('aria-controls', `${listId}-commands ${listId}`)
    if (activeId) input.setAttribute('aria-activedescendant', activeId)
    else input.removeAttribute('aria-activedescendant')
    document.getElementById(activeId ?? '')?.scrollIntoView({ block: 'nearest' })
    function onKey(event: KeyboardEvent) {
      const action = searchKeyAction(event, false, count, isMac)

      if (!action) return
      event.preventDefault()
      if (action === 'next' || action === 'previous') {
        setSelected((previous) => (previous + (action === 'next' ? 1 : -1) + count) % count)
      } else if (selectedIndex < commands.length) onCommand(commands[selectedIndex].id)
      else if (mode === 'people') onChoosePerson(results.people[selectedIndex])
      else {
        const { conversation } = results.sessions[selectedIndex - commands.length]

        onOpen(conversation.sessionId, action === 'beside')
      }
    }
    input.addEventListener('keydown', onKey)

    return () => {
      input.removeEventListener('keydown', onKey)
      input.removeAttribute('aria-activedescendant')
      input.removeAttribute('aria-controls')
    }
  }, [
    activeId,
    commands,
    count,
    inputRef,
    listId,
    mode,
    onChoosePerson,
    onCommand,
    onOpen,
    results.people,
    results.sessions,
    selectedIndex,
  ])

  const heading =
    mode === 'people'
      ? t('People in {team}', { team: teamName })
      : owner
        ? t('Agents by {name}', { name: owner.name || owner.email })
        : results.recent
          ? t('Recently opened')
          : t('Agents')

  const shownCount = `${resultCount}${results.hasMore ? '+' : ''}`

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      {commands.length > 0 && (
        <PaletteCommandRows
          listId={listId}
          commands={commands}
          query={query}
          selectedIndex={selectedIndex}
          onSelect={setSelected}
          onRun={(command) => onCommand(command.id)}
        />
      )}
      <div className="flex h-8 items-center justify-between gap-3 px-4 text-xs text-secondary">
        <span className="truncate font-medium">{heading}</span>
        {!busy && (
          <span className="shrink-0 text-secondary">
            {mode === 'people'
              ? resultCount === 1
                ? t('{n} person', { n: shownCount })
                : t('{n} people', { n: shownCount })
              : resultCount === 1
                ? t('{n} result', { n: shownCount })
                : t('{n} results', { n: shownCount })}
          </span>
        )}
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={heading}
        aria-busy={busy}
        className="space-y-0.5 px-2 pb-2"
      >
        {!busy &&
          mode === 'people' &&
          results.people.map((person, index) => (
            <SearchResultRow
              key={person.id}
              id={`${listId}-${index}`}
              title={person.name || person.email}
              subtitle={person.email}
              query={query}
              selected={index === selectedIndex}
              avatar={
                <Avatar
                  src={person.avatarURL}
                  name={person.name || person.email}
                  size={28}
                  className="shrink-0 rounded-full"
                />
              }
              action={t('View agents')}
              onSelect={() => setSelected(index)}
              onOpen={() => onChoosePerson(person)}
            />
          ))}
        {!busy &&
          mode === 'sessions' &&
          results.sessions.map(({ conversation, openedAt }, index) => (
            <SearchResultRow
              key={conversation.sessionId}
              id={`${listId}-${commands.length + index}`}
              preview={
                conversation.title &&
                !searchMatch(conversation.title, query) &&
                searchMatch(conversation.firstMessage, query)
                  ? conversation.firstMessage
                  : undefined
              }
              title={conversation.title || conversation.firstMessage || t('Untitled agent')}
              subtitle={subtitleFor({ conversation, openedAt })}
              query={query}
              selected={commands.length + index === selectedIndex}
              avatar={
                <AgentAvatar
                  agentId={conversation.sessionId}
                  avatar={conversation.avatar}
                  provider={conversation.agentRuntime}
                  size={28}
                />
              }
              action={t('Open')}
              onSelect={() => setSelected(commands.length + index)}
              onOpen={(beside) => onOpen(conversation.sessionId, beside)}
            />
          ))}
      </div>
      <div role="status" className="px-4 text-sm text-secondary">
        {busy && <p className="py-5">{t('Searching…')}</p>}
        {!busy && !results.error && resultCount === 0 && (
          <p className="py-5">
            {results.recent
              ? t('Agents you open will appear here. Type to search your team.')
              : mode === 'people'
                ? t('No people found. Try another name or email.')
                : t('No agents found. Try another search or clear the person filter.')}
          </p>
        )}
        {!busy && results.error && (
          <p className="py-4">
            {t('Some results could not be loaded.')}{' '}
            <button className="text-main underline" onClick={results.retry}>
              {t('Retry')}
            </button>
          </p>
        )}
      </div>
      {!busy && results.hasMore && (
        <button
          className="mb-3 w-full py-2 text-xs text-secondary hover:text-main disabled:opacity-50"
          disabled={results.loadingMore}
          onClick={() => void results.loadMore()}
        >
          {results.loadingMore ? t('Loading…') : t('Load more agents')}
        </button>
      )}
      {!busy && mode === 'people' && count > 0 && (
        <p className="px-4 pb-3 text-xs text-secondary">
          {t('Choose a teammate, then search within their agents.')}
        </p>
      )}
    </div>
  )
}
