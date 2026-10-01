export type BindingAccess = {
  memberAllowList: string[]
  updatedAt: Date
  updatedBy: string
}

/** Legacy marker retained only to keep retired credentials out of agent access.
 * New bindings cannot set it; remove and explicitly reconnect instead. */
export type BindingPurpose = 'permission-admin'

export type EncryptedEnvelope = {
  v: 1
  alg: 'A256GCM'
  keyId: string
  iv: string
  authTag: string
  ciphertext: string
}
