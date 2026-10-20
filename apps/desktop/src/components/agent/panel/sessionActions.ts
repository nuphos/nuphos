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
