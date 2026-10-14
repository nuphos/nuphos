import type { ConnectorInfoProvider } from '../../lib/appRoutes'
import type { TailscaleSandboxAccess } from '../../types'

/**
 * Badge shown on the connection row. Defaults to a green "Connected"; a
 * loader overrides it when the team-level connection is fine but something
 * the current user must still do (e.g. link their own account) is pending.
 */
export type ConnectorInfoStatus = { label: string; tone: 'ok' | 'warn' }

export type ConnectorInfo = {
  name: string
  fields: { label: string; value: string; mono?: boolean }[]
  externalUrl: string | null
  externalLabel: string
  status?: ConnectorInfoStatus
  tailscaleSandboxAccess?: TailscaleSandboxAccess | null
}

export type ConnectorInfoLoader = (
  teamId: string,
  connectorId: string,
) => Promise<ConnectorInfo | null>

export type ConnectorInfoLoaders = Partial<Record<ConnectorInfoProvider, ConnectorInfoLoader>>
