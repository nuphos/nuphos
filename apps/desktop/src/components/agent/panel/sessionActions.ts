import type { Tab } from './model.ts'

type StoredTab = Partial<Pick<Tab, 'connected' | 'messages' | 'unsaved' | 'openedAt'>>

type GateTab = StoredTab &
  Partial<Pick<Tab, 'sessionId' | 'readOnly' | 'foreign' | 'canManage' | 'archived' | 'watching'>>

/** Which titlebar session actions the active chat allows. Participants, pin,
 *  links, rename and archive all need a session the server has stored, so a
 *  new chat or an unsaved fork gets none of them until the server has it. */
export function sessionActionGates(tab: GateTab | null | undefined) {
  const saved = Boolean(tab?.sessionId && serverHasConversation(tab))
  const writable = saved && !tab?.readOnly

  return {
    saved,
    canRename: writable && !tab?.foreign,
    // The server lets the owner or a manager archive.
    canArchive: writable && !tab?.archived && (!tab?.foreign || tab.canManage === true),
    // Anyone who can read a chat may watch it.
    watching: saved ? tab?.watching : undefined,
  }
}

/** A new chat's conversation is stored with its first turn, before the backend
 *  answers it: until its stream starts or a reply is on record, reading the
 *  conversation finds nothing. One opened from the server is stored. An unsaved
 *  fork carries its source's replies but is not stored yet either. */
export function serverHasConversation(tab: StoredTab) {
  if (tab.unsaved) return false

  return (
    tab.openedAt !== undefined ||
    tab.connected === true ||
    Boolean(tab.messages?.some((message) => message.role === 'assistant'))
  )
}
