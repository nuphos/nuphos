import { sealers } from '@/lib/byos/secrets'
import { personalCredentials, teamByosBindings } from '@/models'

import type { EncryptedSecret, SealerName } from '@/lib/byos/secrets'
import type { Collection, Document } from 'mongodb'

/** The sealer for the envelopes in each team_byos_bindings array. */
export const BINDING_SEALERS: Partial<Record<string, SealerName>> = {
  asanaAccounts: 'asana',
  betterStackIntegrations: 'betterStack',
  cloudflareAccounts: 'cloudflare',
  gitlabAccounts: 'gitlab',
  grafanaInstances: 'grafana',
  hetznerAccounts: 'hetzner',
  jiraSites: 'jira',
  larkApps: 'lark',
  linearWorkspaces: 'linear',
  linodeAccounts: 'linode',
  notionIntegrations: 'notion',
  onpremClusters: 'onprem',
  plaudAccounts: 'plaud',
  posthogIntegrations: 'posthog',
  resendIntegrations: 'resend',
  secureframeIntegrations: 'secureframe',
  sentryAccounts: 'sentry',
  slackWorkspaces: 'slack',
  sonarqubeIntegrations: 'sonarqube',
  tailscaleClients: 'tailscale',
  upstashAccounts: 'upstash',
  uptimeKumaInstances: 'uptimeKuma',
  vantaIntegrations: 'vanta',
  zeaburProviders: 'zeabur',
}

const bindingSealer = (field: string) => BINDING_SEALERS[field]

export type RewrapCounts = {
  /** Already sealed with the current key. */
  current: number
  /** Re-sealed with the current key (or would be, in a dry run). */
  rewrapped: number
  /** Opened by neither key; left alone. */
  failed: number
  /** In a field with no known sealer; left alone. */
  unmapped: number
  /** Changed by someone else between read and write; rerun to pick it up. */
  raced: number
}

export type RewrapUpdate = { path: string; from: EncryptedSecret; to: EncryptedSecret }

function isEnvelope(value: object): value is EncryptedSecret {
  return 'ciphertext' in value && 'authTag' in value && 'iv' in value
}

/** Every envelope inside `value`, with its dotted Mongo path. */
export function findEnvelopes(
  value: unknown,
  path: string,
): { path: string; envelope: EncryptedSecret }[] {
  if (typeof value !== 'object' || value === null) return []
  if (isEnvelope(value)) return [{ path, envelope: value }]
  // Skip ObjectId, Date, Binary and the like: only plain data holds envelopes.
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return []

  return Object.entries(value).flatMap(([key, child]) => findEnvelopes(child, `${path}.${key}`))
}

/** The writes that move one document's envelopes onto their sealer's current key. */
export function planRewrap(
  doc: Document,
  sealerFor: (field: string) => SealerName | undefined,
): { counts: RewrapCounts; updates: RewrapUpdate[] } {
  const counts: RewrapCounts = { current: 0, rewrapped: 0, failed: 0, unmapped: 0, raced: 0 }
  const updates: RewrapUpdate[] = []

  for (const [field, value] of Object.entries(doc)) {
    const found = findEnvelopes(value, field)
    const name = sealerFor(field)

    if (!name) {
      counts.unmapped += found.length
      continue
    }
    for (const { path, envelope } of found) {
      try {
        const to = sealers[name].rewrap(envelope)

        if (to) updates.push({ path, from: envelope, to })
        else counts.current += 1
      } catch {
        counts.failed += 1
      }
    }
  }

  return { counts, updates }
}

async function rewrapCollection(
  collection: Collection,
  sealerFor: (doc: Document) => (field: string) => SealerName | undefined,
  dryRun: boolean,
): Promise<RewrapCounts> {
  const total: RewrapCounts = { current: 0, rewrapped: 0, failed: 0, unmapped: 0, raced: 0 }

  for await (const doc of collection.find()) {
    const { counts, updates } = planRewrap(doc, sealerFor(doc))

    for (const key of Object.keys(counts) as (keyof RewrapCounts)[]) total[key] += counts[key]
    for (const { path, from, to } of updates) {
      if (dryRun) {
        total.rewrapped += 1
        continue
      }
      // Only replace the exact envelope that was read.
      const res = await collection.updateOne(
        { _id: doc._id, [`${path}.ciphertext`]: from.ciphertext },
        { $set: { [path]: to } },
      )

      total[res.modifiedCount === 1 ? 'rewrapped' : 'raced'] += 1
    }
  }

  return total
}

/**
 * Re-seals every stored BYOK envelope that only a `<KEY>_PREVIOUS` key opens.
 * Covers the durable stores; the TTL-reaped OAuth pending collections are left
 * to expire.
 */
export async function rewrapByokSecrets(options: {
  dryRun: boolean
}): Promise<Record<string, RewrapCounts>> {
  return {
    team_byos_bindings: await rewrapCollection(
      teamByosBindings() as unknown as Collection,
      () => bindingSealer,
      options.dryRun,
    ),
    personal_credentials: await rewrapCollection(
      personalCredentials() as unknown as Collection,
      (doc) => (field) =>
        field.startsWith('encrypted') ? (doc.provider as SealerName) : undefined,
      options.dryRun,
    ),
  }
}
