import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

import { useToolbarPrimaryAction } from '../../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { BindAccountDialog } from '../BindAccountDialog'

// Marks a human-only permission-admin binding in the role/SA lists.
export function RetiredBindingBadge() {
  return (
    <span
      title="Retired connection — remove and reconnect to use with the agent"
      className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zViolet-500/15 text-zViolet-accent whitespace-nowrap"
    >
      Retired connection
    </span>
  )
}

// A binding that works but is misconfigured for some operation. The full reason
// (and the command that fixes it) is in the identity's permissions readout; this
// only has to make the row worth clicking.
export function BindingWarningIndicator({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null

  return (
    <span
      title={warnings.join('\n\n')}
      aria-label="Misconfigured — open for details"
      className="flex-shrink-0 text-warning"
    >
      <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
    </span>
  )
}

// AWS, GCP and Azure each hold many identities under one connector, so their
// list pages get a "bind another" CTA on the toolbar's filter row. The page
// already names the provider, so this skips the connector-type picker and opens
// that provider's bind dialog directly.
const BIND_ANOTHER_LABEL = {
  aws: 'Bind new role',
  gcp: 'Bind new service account',
  azure: 'Bind new app',
} as const

export function BindAnotherIdentity({
  provider,
  teamId,
  onBound,
  onOpenAgentChat,
}: {
  provider: keyof typeof BIND_ANOTHER_LABEL
  teamId: string
  onBound: () => void
  /** Opens agent-assisted connector setup after the user chooses it. */
  onOpenAgentChat?: (prompt: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { isActive } = useWorkspaceTab()

  useToolbarPrimaryAction(isActive ? BIND_ANOTHER_LABEL[provider] : null, () => setOpen(true))

  return (
    <BindAccountDialog
      open={open}
      teamId={teamId}
      initialProvider={provider}
      onOpenAgentChat={onOpenAgentChat}
      onClose={() => setOpen(false)}
      onBound={() => {
        setOpen(false)
        onBound()
      }}
    />
  )
}
