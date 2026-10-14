import type { ConnectorInfoProvider } from '../../lib/appRoutes'
import type { TailscaleSandboxAccess } from '../../types'

export type ConnectorInfo = {
  name: string
  fields: { label: string; value: string; mono?: boolean }[]
  externalUrl: string | null
  externalLabel: string
  tailscaleSandboxAccess?: TailscaleSandboxAccess | null
}

export type ConnectorInfoLoader = (
  teamId: string,
  connectorId: string,
) => Promise<ConnectorInfo | null>

export type ConnectorInfoLoaders = Partial<Record<ConnectorInfoProvider, ConnectorInfoLoader>>
