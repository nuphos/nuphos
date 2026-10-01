export type EncryptedSecret = {
  v: 1
  alg: 'A256GCM'
  keyId: string
  iv: string
  authTag: string
  ciphertext: string
}

export function decodeMasterKey(raw: string, sourceEnv: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  const key = Buffer.from(raw, 'base64')

  if (key.length !== 32) {
    throw new Error(`${sourceEnv} must decode to 32 bytes`)
  }

  return key
}
