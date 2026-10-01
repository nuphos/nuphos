import type { AddIntegrationKey } from '../addIntegrationCatalog'

export type BindMode = 'install' | 'reinstall'

export type ConnectorAddAction = { label: string; mode: BindMode }

/**
 * What the "add" affordance does for a connector kind that already has a
 * connection. Most kinds accept any number of connections; Slack re-runs its
 * OAuth flow against the same workspace, and Lark holds exactly one app per
 * team, so their add action replaces the stored credentials.
 */
export function installedConnectorAddAction(
  provider: AddIntegrationKey,
): ConnectorAddAction | null {
  if (provider === 'slack') return { label: 'Reinstall', mode: 'reinstall' }
  if (provider === 'lark') return { label: 'Reconfigure', mode: 'reinstall' }

  return { label: 'Add', mode: 'install' }
}
