import { existsSync } from 'node:fs'

import { config } from '@/config'

/** The optional local HTTPS pair from ATLAS_DEV_TLS_CERT / ATLAS_DEV_TLS_KEY. */
export function devTlsOptions(): Bun.TLSOptions | undefined {
  const { tlsCertPath, tlsKeyPath } = config.server

  if (!tlsCertPath && !tlsKeyPath) return undefined
  if (!tlsCertPath || !tlsKeyPath) {
    throw new Error('Both ATLAS_DEV_TLS_CERT and ATLAS_DEV_TLS_KEY are required to enable HTTPS')
  }
  if (!existsSync(tlsCertPath)) throw new Error(`ATLAS_DEV_TLS_CERT not found: ${tlsCertPath}`)
  if (!existsSync(tlsKeyPath)) throw new Error(`ATLAS_DEV_TLS_KEY not found: ${tlsKeyPath}`)

  return {
    cert: Bun.file(tlsCertPath),
    key: Bun.file(tlsKeyPath),
  }
}
