/** A device in the signed-in user's vault, as the main process reports it. */
export type VaultDevice = {
  id: string
  name: string
  state: 'pending' | 'enrolled'
  /** Compared on both screens before a device is approved. */
  fingerprint: string
}

export type VaultStatus = {
  /** This app's device, when the vault knows it. */
  thisDeviceId: string | null
  devices: VaultDevice[]
}

export type VaultItemSummary = { name: string; updatedAt: string }

/** An enrolled device of a team member, and whether it is in the team's shared vault. */
export type TeamVaultDevice = {
  id: string
  name: string
  /** The member it belongs to. */
  userName: string
  shared: boolean
  fingerprint: string
}

export type TeamVaultStatus = { thisDeviceId: string | null; devices: TeamVaultDevice[] }
