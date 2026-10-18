import type { IntegrationPlatformRow } from '../cloud/team-home-bind'

/**
 * The connector-list row behind one connection of a detail page. Discord, Slack and Lark load as
 * a single connection named after the provider, so they match the provider's deletable row.
 */
export function connectorRowFor(
  rows: IntegrationPlatformRow[],
  provider: string,
  connectorId: string,
): IntegrationPlatformRow | undefined {
  const rowProvider = provider === 'mongodb' ? 'database' : provider
  const exact = rows.find((row) => row.key === `${rowProvider}:${connectorId}`)

  if (exact || connectorId !== provider) return exact

  return rows.find((row) => row.provider === rowProvider && row.onDelete)
}
