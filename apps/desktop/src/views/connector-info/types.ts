import type { ConnectorInfoProvider } from '../../lib/appRoutes'
import type { TailscaleSandboxAccess } from '../../types'

export type ConnectorInfo = {
  name: string
  fields: { label: string; value: string; mono?: boolean }[]
  externalUrl: string | null
  externalLabel: string
  /**
   * Replaces the green "Connected" badge with an amber one carrying this
   * label: the team-level connection is fine, but the current user still has
   * something to do (e.g. link their own account).
   */
  warning?: string
  tailscaleSandboxAccess?: TailscaleSandboxAccess | null
}

export type ConnectorInfoLoader = (
  teamId: string,
  connectorId: string,
) => Promise<ConnectorInfo | null>

export type ConnectorInfoLoaders = Partial<Record<ConnectorInfoProvider, ConnectorInfoLoader>>
