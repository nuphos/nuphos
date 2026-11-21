import type { Tab } from './model.ts'

type StoredTab = Partial<Pick<Tab, 'connected' | 'messages' | 'unsaved' | 'openedAt' | 'stored'>>

type GateTab = StoredTab &
  Partial<
    Pick<
      Tab,
      'sessionId' | 'readOnly' | 'foreign' | 'canManage' | 'canArchive' | 'archived' | 'watching'
    >
  >

/** Which titlebar session actions the active chat allows. Participants, pin,
 *  links, rename and archive all need a session the server has stored, so a
 *  new chat or an unsaved fork gets none of them until the server has it. */
export function sessionActionGates(tab: GateTab | null | undefined) {
  const saved = Boolean(tab?.sessionId && serverHasConversation(tab))
  const writable = saved && !tab?.readOnly

  return {
    saved,
    canRename: writable && !tab?.foreign,
    canArchive: writable && !tab?.archived && mayArchive(tab),
    // Anyone who can read a chat may watch it.
    watching: saved ? tab?.watching : undefined,
  }
}

/** The server's canArchive: the owner, or a participant in a Task for themselves
 *  alone. A chat not opened from the server yet is the viewer's own. */
function mayArchive(tab: GateTab | null | undefined) {
  return tab?.canArchive ?? (!tab?.foreign || tab.canManage === true)
}

/** A new chat's conversation is stored with its first turn, before the backend
 *  answers it: until its stream starts or a reply is on record, reading the
 *  conversation finds nothing. One opened from the server is stored. An unsaved
 *  fork carries its source's replies but is not stored yet either. */
export function serverHasConversation(tab: StoredTab) {
  if (tab.unsaved) return false

  return (
    tab.openedAt !== undefined ||
    tab.stored === true ||
    tab.connected === true ||
    Boolean(tab.messages?.some((message) => message.role === 'assistant'))
  )
}

/** The route stores a new conversation before accepting its run and queues only
 *  a stored one, so any frame of the run, or a queued reply, proves it exists.
 *  A request refused before that (an HTTP error) proves nothing. */
export function provesStored(evType: string | undefined) {
  return evType === 'sse' || evType === 'queued'
}
