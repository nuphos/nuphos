import { useEffect, useId, useMemo, useState } from 'react'

import { t } from '../../i18n'
import { isMac } from '../../lib/platform'
import { searchKeyAction } from '../../lib/searchKeyboard'
import { searchMatch } from '../../lib/searchMatch'
import { AgentAvatar } from '../agent/AgentAvatar'
import { Avatar } from '../Avatar'
import { ChatIcon } from '../channels/channelParts'

import { PaletteCommandRows } from './PaletteCommandRows'
import { matchPaletteCommands } from './paletteCommands'
import { kindOf, metaFor, trackOpened } from './searchResultMeta'
import { GroupLabel, ResultSkeleton } from './searchResultParts'
import { SearchResultRow } from './SearchResultRow'
import { useSearchResults } from './useSearchResults'

import type { SessionResult } from './useSearchResults'
import type { TeamMember } from '../../types'
import type { RefObject } from 'react'

/** When it was opened, and whose it is when it isn't yours. */
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
  // As the sidebar lists them: chats (channels and Bots' chats) under Bots, every agent under Tasks.
  const sessions = useMemo(() => {
    const chats = results.sessions.filter(({ conversation }) => conversation.kind === 'channel')
    const tasks = results.sessions.filter(({ conversation }) => conversation.kind !== 'channel')

    return { chats, tasks, ordered: [...chats, ...tasks] }
  }, [results.sessions])
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
      } else if (selectedIndex < commands.length) {
        trackOpened('command', selectedIndex, 'keyboard', query)
        onCommand(commands[selectedIndex].id)
      } else if (mode === 'people') {
        trackOpened('person', selectedIndex, 'keyboard', query)
        onChoosePerson(results.people[selectedIndex])
      } else {
        const result = sessions.ordered[selectedIndex - commands.length]

        trackOpened(kindOf(result), selectedIndex, 'keyboard', query)
        const { conversation } = result

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
    query,
    results.people,
    sessions.ordered,
    selectedIndex,
  ])

  const heading =
    mode === 'people'
      ? t('People in {team}', { team: teamName })
      : owner
        ? t('Agents by {name}', { name: owner.name || owner.email })
        : t('Agents')
  const sessionRow = (result: SessionResult, index: number) => {
    const { conversation } = result
    const at = commands.length + index

    return (
      <SearchResultRow
        key={conversation.sessionId}
        id={`${listId}-${String(at)}`}
        preview={
          conversation.title &&
          !searchMatch(conversation.title, query) &&
          searchMatch(conversation.firstMessage, query)
            ? conversation.firstMessage
            : undefined
        }
        title={conversation.title || conversation.firstMessage || t('Untitled agent')}
        meta={metaFor(result, userId)}
        query={query}
        selected={at === selectedIndex}
        avatar={
          conversation.kind === 'channel' ? (
            <ChatIcon faces={conversation.faces} title={conversation.title} size={24} />
          ) : (
            // A Task wears its runtime's mark, as in the sidebar.
            <span className="flex size-6 shrink-0 items-center justify-center">
              <AgentAvatar
                agentId={conversation.sessionId}
                provider={conversation.agentRuntime}
                face={false}
                size={18}
              />
            </span>
          )
        }
        action={t('Open')}
        onSelect={() => setSelected(at)}
        onOpen={(beside) => {
          trackOpened(kindOf(result), at, 'mouse', query)
          onOpen(conversation.sessionId, beside)
        }}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      {commands.length > 0 && (
        <PaletteCommandRows
          listId={listId}
          commands={commands}
          query={query}
          selectedIndex={selectedIndex}
          onSelect={setSelected}
          onRun={(command) => {
            trackOpened('command', commands.indexOf(command), 'mouse', query)
            onCommand(command.id)
          }}
        />
      )}
      <div
        id={listId}
        role="listbox"
        aria-label={heading}
        aria-busy={busy}
        className="space-y-0.5 px-2 pb-2"
      >
        {!busy && (mode === 'people' || owner) && resultCount > 0 && <GroupLabel text={heading} />}
        {!busy &&
          mode === 'people' &&
          results.people.map((person, index) => (
            <SearchResultRow
              key={person.id}
              id={`${listId}-${index}`}
              title={person.name || person.email}
              meta={person.email}
              query={query}
              selected={index === selectedIndex}
              avatar={
                <Avatar
                  src={person.avatarURL}
                  name={person.name || person.email}
                  size={24}
                  className="shrink-0 rounded-full"
                />
              }
              action={t('View agents')}
              onSelect={() => setSelected(index)}
              onOpen={() => {
                trackOpened('person', index, 'mouse', query)
                onChoosePerson(person)
              }}
            />
          ))}
        {!busy && mode === 'sessions' && owner && sessions.ordered.map(sessionRow)}
        {!busy && mode === 'sessions' && !owner && sessions.chats.length > 0 && (
          <GroupLabel text={t('Bots')} />
        )}
        {!busy && mode === 'sessions' && !owner && sessions.chats.map(sessionRow)}
        {!busy && mode === 'sessions' && !owner && sessions.tasks.length > 0 && (
          <GroupLabel text={t('Tasks')} />
        )}
        {!busy &&
          mode === 'sessions' &&
          !owner &&
          sessions.tasks.map((result, index) => sessionRow(result, sessions.chats.length + index))}
      </div>
      {busy && <ResultSkeleton />}
      <div role="status" className="px-4 text-sm text-secondary">
        {busy && <span className="sr-only">{t('Searching…')}</span>}
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
