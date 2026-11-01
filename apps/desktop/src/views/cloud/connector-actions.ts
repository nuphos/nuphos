import { t } from '../../i18n/index.ts'

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
  if (provider === 'slack') return { label: t('Reinstall'), mode: 'reinstall' }
  if (provider === 'lark') return { label: t('Reconfigure'), mode: 'reinstall' }

  return { label: t('Add'), mode: 'install' }
}

/**
 * Hover, pressed and keyboard-focus state shared by every clickable connector row and installed
 * icon. Focus reuses the hover fill plus a neutral outline around the whole target instead of the
 * app's violet inset ring; zGray-500 is the theme pivot, so it keeps contrast in light and dark.
 */
export const CONNECTOR_HOVER = [
  'cursor-pointer transition-colors hover:bg-zGray-850 active:bg-zGray-800',
  'focus-visible:bg-zGray-850 focus-visible:shadow-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-zGray-500',
  'has-[:focus-visible]:bg-zGray-850 has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-zGray-500',
].join(' ')
