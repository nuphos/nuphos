import type { Tab } from './model'

/**
 * Whether this conversation's composer offers its own permission mode menu.
 * A Task under a Bot (`credentialSource`) runs in the Bot's mode, so it has none.
 */
export function ownsPermissionMode(
  tab: Pick<Tab, 'sessionId' | 'readOnly' | 'foreign' | 'canManage' | 'credentialSource'>,
): boolean {
  return Boolean(
    tab.sessionId && !tab.readOnly && (!tab.foreign || tab.canManage) && !tab.credentialSource,
  )
}
