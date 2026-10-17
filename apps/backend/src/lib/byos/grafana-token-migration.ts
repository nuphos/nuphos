import { decryptGrafanaSecret, encryptGrafanaSecret } from '@/lib/byos/secrets'
import { teamByosBindings } from '@/models'

import type { GrafanaInstanceBinding } from '@/models'

export type GrafanaTokenStep = 'encrypt' | 'unset-plaintext' | 'skip'

/**
 * Two phases so a rollback stays possible: `encrypt` only adds the encrypted
 * copy; `unset-plaintext` drops the plaintext once the copy decrypts to it.
 */
export function grafanaTokenStep(
  binding: Pick<GrafanaInstanceBinding, 'saToken' | 'encryptedSaToken'>,
  unsetPlaintext: boolean,
): GrafanaTokenStep {
  if (!binding.saToken) return 'skip'
  if (!binding.encryptedSaToken) return 'encrypt'
  if (!unsetPlaintext) return 'skip'
  if (decryptGrafanaSecret(binding.encryptedSaToken) !== binding.saToken) {
    throw new Error("A Grafana binding's encrypted token does not match its plaintext token")
  }

  return 'unset-plaintext'
}

export async function migrateGrafanaTokens(options: {
  dryRun: boolean
  unsetPlaintext: boolean
}): Promise<Record<GrafanaTokenStep, number>> {
  const counts: Record<GrafanaTokenStep, number> = { encrypt: 0, 'unset-plaintext': 0, skip: 0 }
  const docs = teamByosBindings().find(
    { 'grafanaInstances.saToken': { $exists: true } },
    { projection: { grafanaInstances: 1 } },
  )

  for await (const doc of docs) {
    for (const binding of doc.grafanaInstances) {
      const step = grafanaTokenStep(binding, options.unsetPlaintext)

      counts[step] += 1
      if (options.dryRun || step === 'skip') continue
      if (step === 'encrypt' && binding.saToken) {
        await teamByosBindings().updateOne(
          { _id: doc._id },
          {
            $set: {
              'grafanaInstances.$[g].encryptedSaToken': encryptGrafanaSecret(binding.saToken),
            },
          },
          { arrayFilters: [{ 'g.id': binding.id, 'g.encryptedSaToken': { $exists: false } }] },
        )
      } else if (step === 'unset-plaintext') {
        await teamByosBindings().updateOne(
          { _id: doc._id },
          { $unset: { 'grafanaInstances.$[g].saToken': '' } },
          { arrayFilters: [{ 'g.id': binding.id, 'g.encryptedSaToken': { $exists: true } }] },
        )
      }
    }
  }

  return counts
}
