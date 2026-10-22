import type { Tab } from './model.ts'

type GateTab = Pick<
  Tab,
  'sessionId' | 'readOnly' | 'foreign' | 'canManage' | 'archived' | 'unsaved' | 'watching'
>

/** Which titlebar session actions the active chat allows. Pin, links, rename
 *  and archive all need a session the server has stored, so an unsaved fork
 *  gets none of them until its first turn is sent. */
export function sessionActionGates(tab: GateTab | null | undefined) {
  const saved = Boolean(tab?.sessionId && !tab.unsaved)
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

/** A new chat's conversation is stored with its first turn. Until the server
 *  answers (its stream starts, or a reply is on record), reading the
 *  conversation's settings finds nothing. */
export function serverHasConversation(tab: Pick<Tab, 'connected' | 'messages'>) {
  return tab.connected || tab.messages.some((message) => message.role === 'assistant')
}
