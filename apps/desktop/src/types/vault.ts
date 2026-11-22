/** A device in the signed-in user's vault, as the main process reports it. */
export type VaultDevice = {
  id: string
  name: string
  state: 'pending' | 'enrolled'
  createdAt: string
  /** Compared on both screens before a device is approved. */
  fingerprint: string
}

export type VaultStatus = {
  /** This app's device, when the vault knows it. */
  thisDeviceId: string | null
  devices: VaultDevice[]
}

export type VaultItemSummary = { name: string; updatedAt: string }
