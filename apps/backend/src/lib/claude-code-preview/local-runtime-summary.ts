import type { LocalAgentProvider } from '@/lib/agent/devices/local-runtime/protocol'
import type { LocalShareLevel } from '@/lib/agent/devices/local-share-types'
import type { AgentDeviceBox } from '@/lib/agent/devices/store'

/** A computer's agent as the runtime catalog lists it for one person. */
export type LocalRuntimeSummary = {
  /** Who owns the computer; its address names the transport owner, which a handover keeps. */
  ownerUserId: string
  deviceId: string
  deviceLabel: string
  /** The agent's own name; absent while it has its provider's. */
  agentLabel?: string
  instanceId?: string
  /** The team member who added this agent through Nuphos; absent for older and default agents. */
  addedBy?: { userId: string; at: string }
  /** Who last signed it in through Nuphos: everyone who uses the computer runs on that account. */
  signedInBy?: { userId: string; at: string }
  agentInstances?: boolean
  /** Whether the computer reports this agent right now. */
  online: boolean
  /** Whether the owner's own CLI is signed in; null when the computer cannot tell. */
  signedIn: boolean | null
  /** Seen signed in at least once: the agent registry. A host's default agent no one used has none. */
  everSignedIn?: true
  /** Provider usage the computer reported, raw; normalized in runtime-quota. */
  usage?: unknown
  /** When that computer read the usage above. */
  usageAt?: string
  /** Present when the computer is a Box Nuphos made, rather than someone's own machine. */
  box?: Pick<AgentDeviceBox, 'provider'>
  /** Present when it is a teammate's own computer they share with the viewer; see local-share. */
  shared?: { level: Exclude<LocalShareLevel, 'off'> }
  /** The computer opens its desktop on request (runtime-desktop). */
  desktopOpen?: true
}

export type LocalRuntimeInstance = {
  id: string
  provider: LocalAgentProvider
  label: string
  status: 'active'
  kind: 'local'
  createdAt: string
  local: LocalRuntimeSummary
}
